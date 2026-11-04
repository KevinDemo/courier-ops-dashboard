using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;

namespace Harbour.Ops.Api;

public sealed record Kpis(int JobsToday, double? OnTimePercent, int Delivered, int Late, int Unassigned, int Failed);

public sealed record HourBucket(int Hour, int OnTime, int Late, int Open, int Failed);

public sealed record JobRow(
    int Id, string Number, string Customer, string PickupSuburb, string DeliverySuburb, ServiceLevel Service,
    JobStatus Status, int? DriverId, string? Driver, DateTime ReadyAt, DateTime DueAt, DateTime? DeliveredAt, bool IsLate);

public sealed record JobEventRow(DateTime At, JobStatus Status, string Note);

public sealed record JobDetail(JobRow Job, int Pieces, decimal WeightKg, string? Vehicle, IReadOnlyList<JobEventRow> Events);

public sealed record PagedJobs(IReadOnlyList<JobRow> Items, int Total, int Page, int PageSize);

public sealed record JobQuery(string? Q, JobStatus? Status, ServiceLevel? Service, int? DriverId, bool? LateOnly, string? Sort, string? Dir, int? Page, int? PageSize);

public sealed class OpsQueries(OpsDb db, OpsCalendar calendar)
{
    public const int MaxPageSize = 100;

    public static readonly IReadOnlySet<string> SortableColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "number", "customer", "route", "service", "driver", "readyAt", "dueAt", "status",
    };

    private IQueryable<Job> Today()
    {
        var (start, end) = calendar.TodayWindow();
        return db.Jobs.AsNoTracking().Where(j => j.ReadyAt >= start && j.ReadyAt < end);
    }

    public async Task<Kpis> GetKpisAsync(CancellationToken cancellationToken)
    {
        var jobs = await Today().ToListAsync(cancellationToken);
        var isLate = JobRules.IsLate(calendar.NowUtc).Compile();
        var delivered = jobs.Where(j => j.Status == JobStatus.Delivered).ToList();
        double? onTime = delivered.Count == 0 ? null : Math.Round(100.0 * delivered.Count(j => !isLate(j)) / delivered.Count, 1);
        return new Kpis(jobs.Count, onTime, delivered.Count, jobs.Count(isLate), jobs.Count(j => j.Status == JobStatus.Unassigned), jobs.Count(j => j.Status == JobStatus.Failed));
    }

    public async Task<IReadOnlyList<HourBucket>> GetHourlyAsync(CancellationToken cancellationToken)
    {
        var jobs = await Today().ToListAsync(cancellationToken);
        if (jobs.Count == 0) return [];

        var isLate = JobRules.IsLate(calendar.NowUtc).Compile();
        var hours = jobs.Select(j => (Hour: calendar.LocalHour(j.ReadyAt), Job: j)).ToList();
        var buckets = new List<HourBucket>();
        for (var hour = hours.Min(h => h.Hour); hour <= hours.Max(h => h.Hour); hour++)
        {
            var inHour = hours.Where(h => h.Hour == hour).Select(h => h.Job).ToList();
            var failed = inHour.Count(j => j.Status == JobStatus.Failed);
            var late = inHour.Count(isLate);
            var onTime = inHour.Count(j => j.Status == JobStatus.Delivered && !isLate(j));
            buckets.Add(new HourBucket(hour, onTime, late, inHour.Count - onTime - late - failed, failed));
        }
        return buckets;
    }

    public async Task<PagedJobs> GetJobsAsync(JobQuery query, CancellationToken cancellationToken)
    {
        var now = calendar.NowUtc;
        var jobs = Today();

        if (query.Status is { } status) jobs = jobs.Where(j => j.Status == status);
        if (query.Service is { } service) jobs = jobs.Where(j => j.Service == service);
        if (query.DriverId is { } driverId) jobs = jobs.Where(j => j.DriverId == driverId);
        if (query.LateOnly == true) jobs = jobs.Where(JobRules.IsLate(now));
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var q = query.Q.Trim().ToLower();
            jobs = jobs.Where(j => j.Number.ToLower().Contains(q) || j.Customer.ToLower().Contains(q)
                || j.PickupSuburb.ToLower().Contains(q) || j.DeliverySuburb.ToLower().Contains(q)
                || (j.Driver != null && j.Driver.Name.ToLower().Contains(q)));
        }

        var total = await jobs.CountAsync(cancellationToken);
        var pageSize = Math.Clamp(query.PageSize ?? 25, 1, MaxPageSize);
        var page = Math.Max(query.Page ?? 1, 1);

        var items = await Sort(jobs, query.Sort, query.Dir)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(ToRow(now))
            .ToListAsync(cancellationToken);
        return new PagedJobs(items, total, page, pageSize);
    }

    public async Task<JobDetail?> GetJobAsync(int id, CancellationToken cancellationToken)
    {
        var now = calendar.NowUtc;
        var row = await db.Jobs.AsNoTracking().Where(j => j.Id == id).Select(ToRow(now)).FirstOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var job = await db.Jobs.AsNoTracking().Include(j => j.Driver).FirstAsync(j => j.Id == id, cancellationToken);
        var events = await db.JobEvents.AsNoTracking().Where(e => e.JobId == id).OrderBy(e => e.At).ThenBy(e => e.Id)
            .Select(e => new JobEventRow(e.At, e.Status, e.Note)).ToListAsync(cancellationToken);
        return new JobDetail(row, job.Pieces, job.WeightKg, job.Driver?.Vehicle, events);
    }

    private static IQueryable<Job> Sort(IQueryable<Job> jobs, string? sort, string? dir)
    {
        var descending = string.Equals(dir, "desc", StringComparison.OrdinalIgnoreCase);
        var ordered = (sort?.ToLowerInvariant() ?? "dueat") switch
        {
            "number" => By(jobs, j => j.Number, descending),
            "customer" => By(jobs, j => j.Customer, descending),
            "route" => By(jobs, j => j.PickupSuburb, descending),
            "service" => By(jobs, j => j.Service, descending),
            "driver" => By(jobs, j => j.Driver == null ? null : j.Driver.Name, descending),
            "readyat" => By(jobs, j => j.ReadyAt, descending),
            "status" => By(jobs, j => j.Status, descending),
            _ => By(jobs, j => j.DueAt, descending),
        };
        // Without a tiebreak, rows with equal values can repeat or vanish between pages.
        return ordered.ThenBy(j => j.Id);
    }

    private static IOrderedQueryable<Job> By<T>(IQueryable<Job> jobs, Expression<Func<Job, T>> key, bool descending) =>
        descending ? jobs.OrderByDescending(key) : jobs.OrderBy(key);

    // Repeats JobRules.IsLate, because EF cannot inline an expression inside this projection.
    // Late_filter_returns_the_same_jobs_the_tile_counts fails if the two ever disagree.
    private static Expression<Func<Job, JobRow>> ToRow(DateTime now) => j => new JobRow(
        j.Id, j.Number, j.Customer, j.PickupSuburb, j.DeliverySuburb, j.Service, j.Status, j.DriverId,
        j.Driver == null ? null : j.Driver.Name, j.ReadyAt, j.DueAt, j.DeliveredAt,
        (j.Status == JobStatus.Delivered && j.DeliveredAt > j.DueAt) || (j.Status != JobStatus.Delivered && j.Status != JobStatus.Failed && j.DueAt < now));
}
