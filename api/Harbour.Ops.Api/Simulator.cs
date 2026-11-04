using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Harbour.Ops.Api;

[Authorize]
public sealed class OpsHub : Hub;

public sealed record JobChanged(int Id, string Number, string Customer, JobStatus Status, string? Driver, DateTime At);

/// <summary>Stands in for drivers' scanners: moves one job on a step, and tells every connected screen.</summary>
public sealed class JobSimulator(IServiceScopeFactory scopes, IHubContext<OpsHub> hub)
{
    private readonly Random _random = new();

    public async Task<JobChanged?> TickAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OpsDb>();
        var calendar = scope.ServiceProvider.GetRequiredService<OpsCalendar>();
        Seeder.EnsureToday(db, calendar);

        var (start, end) = calendar.TodayWindow();
        var now = calendar.NowUtc;
        var open = db.Jobs.Where(j => j.ReadyAt >= start && j.ReadyAt < end && j.Status != JobStatus.Delivered && j.Status != JobStatus.Failed);
        var count = await open.CountAsync(cancellationToken);

        var job = count > 0
            ? await open.Include(j => j.Driver).OrderBy(j => j.Id).Skip(_random.Next(count)).FirstAsync(cancellationToken)
            : await AddNewBookingAsync(db, calendar, now, cancellationToken);

        if (JobRules.Next(job.Status, _random) is { } next)
        {
            job.Status = next;
            if (next == JobStatus.Assigned)
            {
                var ids = await db.Drivers.Select(d => d.Id).ToListAsync(cancellationToken);
                job.DriverId = ids[_random.Next(ids.Count)];
                job.Driver = await db.Drivers.FindAsync([job.DriverId], cancellationToken);
            }
            if (next == JobStatus.Delivered) job.DeliveredAt = now;
            db.JobEvents.Add(new JobEvent { JobId = job.Id, At = now, Status = next, Note = next.ToString() });
            await db.SaveChangesAsync(cancellationToken);
        }

        var change = new JobChanged(job.Id, job.Number, job.Customer, job.Status, job.Driver?.Name, now);
        await hub.Clients.All.SendAsync("jobChanged", change, cancellationToken);
        return change;
    }

    // Late in the day every seeded job is finished, so a new booking keeps the demo moving.
    private static async Task<Job> AddNewBookingAsync(OpsDb db, OpsCalendar calendar, DateTime now, CancellationToken cancellationToken)
    {
        var (start, end) = calendar.TodayWindow();
        var sequence = await db.Jobs.CountAsync(j => j.ReadyAt >= start && j.ReadyAt < end, cancellationToken) + 1;
        var job = new Job
        {
            Number = $"HF{calendar.Today:yyMMdd}{sequence:000}",
            Customer = "Saltmarsh Coffee Roasters",
            PickupSuburb = "Saltmarsh",
            DeliverySuburb = "Port Harlow",
            Service = ServiceLevel.Express,
            ReadyAt = now,
            DueAt = now.AddHours(2),
            Pieces = 1,
            WeightKg = 4.5m,
        };
        job.Events.Add(new JobEvent { At = now, Status = JobStatus.Unassigned, Note = "Booked" });
        db.Jobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);
        return job;
    }
}

public sealed class SimulatorService(JobSimulator simulator, IConfiguration configuration, ILogger<SimulatorService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(configuration.GetValue("Simulator:IntervalSeconds", 3.0));
        using var timer = new PeriodicTimer(interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await simulator.TickAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Simulator tick failed.");
            }
        }
    }
}
