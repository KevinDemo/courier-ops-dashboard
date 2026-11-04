using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Harbour.Ops.Api;

// Declared in workflow order, and stored as a number, so sorting by status follows the workflow.
public enum JobStatus { Unassigned, Assigned, PickedUp, InTransit, Delivered, Failed }

public enum ServiceLevel { Standard, Express, SameDay }

public sealed class Driver
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Vehicle { get; set; }
}

public sealed class Job
{
    public int Id { get; set; }
    public required string Number { get; set; }
    public required string Customer { get; set; }
    public required string PickupSuburb { get; set; }
    public required string DeliverySuburb { get; set; }
    public ServiceLevel Service { get; set; }
    public JobStatus Status { get; set; }
    public int? DriverId { get; set; }
    public Driver? Driver { get; set; }
    public DateTime ReadyAt { get; set; }
    public DateTime DueAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public int Pieces { get; set; }
    public decimal WeightKg { get; set; }
    public List<JobEvent> Events { get; set; } = [];
}

public sealed class JobEvent
{
    public int Id { get; set; }
    public int JobId { get; set; }
    public DateTime At { get; set; }
    public JobStatus Status { get; set; }
    public required string Note { get; set; }
}

/// <summary>The one definition of late, used by SQL filters and in-memory KPIs alike.</summary>
public static class JobRules
{
    /// <summary>Delivered after its due time, or not finished and past its due time. A failed job is counted separately.</summary>
    public static Expression<Func<Job, bool>> IsLate(DateTime now) => j =>
        (j.Status == JobStatus.Delivered && j.DeliveredAt > j.DueAt)
        || (j.Status != JobStatus.Delivered && j.Status != JobStatus.Failed && j.DueAt < now);

    public static JobStatus? Next(JobStatus status, Random random) => status switch
    {
        JobStatus.Unassigned => JobStatus.Assigned,
        JobStatus.Assigned => JobStatus.PickedUp,
        JobStatus.PickedUp => JobStatus.InTransit,
        JobStatus.InTransit => random.NextDouble() < 0.04 ? JobStatus.Failed : JobStatus.Delivered,
        _ => null,
    };
}

public sealed class OpsDb(DbContextOptions<OpsDb> options) : DbContext(options)
{
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<Driver> Drivers => Set<Driver>();
    public DbSet<JobEvent> JobEvents => Set<JobEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Job>().HasIndex(j => j.Number).IsUnique();
        modelBuilder.Entity<Job>().HasIndex(j => j.ReadyAt);
        modelBuilder.Entity<Job>().Property(j => j.WeightKg).HasConversion<double>();
        modelBuilder.Entity<JobEvent>().HasIndex(e => new { e.JobId, e.At });
    }

    // SQLite has no date type, so times come back with no kind. Everything here is UTC, and JSON should say so.
    protected override void ConfigureConventions(ModelConfigurationBuilder builder) =>
        builder.Properties<DateTime>().HaveConversion<UtcConverter>();

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}

public sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

/// <summary>Which instants count as "today" at the depot, whichever time zone the server runs in.</summary>
public sealed class OpsCalendar(TimeProvider clock, TimeZoneInfo zone)
{
    public DateTime NowUtc => clock.GetUtcNow().UtcDateTime;

    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(NowUtc, zone));

    public (DateTime Start, DateTime End) TodayWindow()
    {
        var midnight = Today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return (TimeZoneInfo.ConvertTimeToUtc(midnight, zone), TimeZoneInfo.ConvertTimeToUtc(midnight.AddDays(1), zone));
    }

    public int LocalHour(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(utc, zone).Hour;

    public DateTime LocalToUtc(DateOnly day, int hour, int minute) =>
        TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Unspecified), zone);
}
