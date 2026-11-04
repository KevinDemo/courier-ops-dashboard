using Microsoft.EntityFrameworkCore;

namespace Harbour.Ops.Api;

/// <summary>Generates a believable day of fictional jobs. The same date and clock always give the same rows.</summary>
public static class Seeder
{
    public const int JobsPerDay = 160;

    private static readonly (string Name, string Vehicle)[] Drivers =
    [
        ("Priya Nair", "Van HF-12"), ("Tomas Reyes", "Van HF-07"), ("Aroha Wells", "Truck HF-21"), ("Sam Whitlock", "Van HF-15"),
        ("Lena Hoang", "Bike HF-33"), ("Marcus Doyle", "Truck HF-24"), ("Ines Kovac", "Van HF-09"), ("Theo Barnes", "Van HF-18"),
    ];

    private static readonly string[] Customers =
    [
        "Bellbird Ceramics", "Wattle Cove Homewares", "Kingsbrae Stone", "Quillon Medical Supply", "Tern Bay Tyre and Fleet", "Slipway Mechanical",
        "Oyster Lane Print", "Eastmere Pharmacy Group", "Saltmarsh Coffee Roasters", "Port Harlow Marine", "Ironbark Joinery", "Fernleigh Florists",
    ];

    private static readonly string[] Suburbs =
    [
        "Port Harlow", "Eastmere", "Kingsbrae", "Wattle Cove", "Tern Bay", "Saltmarsh", "Oyster Point", "Fernleigh", "Ironbark Hill", "Slipway",
    ];

    public static void EnsureDrivers(OpsDb db)
    {
        if (db.Drivers.Any()) return;
        db.Drivers.AddRange(Drivers.Select(d => new Driver { Name = d.Name, Vehicle = d.Vehicle }));
        db.SaveChanges();
    }

    public static void EnsureToday(OpsDb db, OpsCalendar calendar)
    {
        EnsureDrivers(db);
        var (start, end) = calendar.TodayWindow();
        if (db.Jobs.Any(j => j.ReadyAt >= start && j.ReadyAt < end)) return;

        var today = calendar.Today;
        var now = calendar.NowUtc;
        var random = new Random(today.DayNumber);
        var driverIds = db.Drivers.OrderBy(d => d.Id).Select(d => d.Id).ToList();
        var prefix = $"HF{today:yyMMdd}";

        for (var i = 1; i <= JobsPerDay; i++)
        {
            var ready = calendar.LocalToUtc(today, random.Next(6, 18), random.Next(0, 12) * 5);
            var service = (ServiceLevel)random.Next(0, 3);
            var due = ready.AddHours(service switch { ServiceLevel.Express => 2, ServiceLevel.SameDay => 4, _ => 6 });
            var job = new Job
            {
                Number = $"{prefix}{i:000}",
                Customer = Customers[random.Next(Customers.Length)],
                PickupSuburb = Suburbs[random.Next(Suburbs.Length)],
                DeliverySuburb = Suburbs[random.Next(Suburbs.Length)],
                Service = service,
                ReadyAt = ready,
                DueAt = due,
                Pieces = random.Next(1, 9),
                WeightKg = Math.Round((decimal)(random.NextDouble() * 80 + 0.5), 1),
                Status = JobStatus.Unassigned,
            };
            var booked = ready.AddMinutes(-20);
            job.Events.Add(new JobEvent { At = booked < now ? booked : now, Status = JobStatus.Unassigned, Note = "Booked" });
            Advance(job, PickStatus(job, now, random), driverIds[random.Next(driverIds.Count)], random, now);
            db.Jobs.Add(job);
        }
        db.SaveChanges();
    }

    private static JobStatus PickStatus(Job job, DateTime now, Random random)
    {
        var roll = random.NextDouble();
        if (job.DueAt < now) return roll < 0.90 ? JobStatus.Delivered : roll < 0.94 ? JobStatus.Failed : JobStatus.InTransit;
        if (job.ReadyAt > now) return roll < 0.65 ? JobStatus.Unassigned : JobStatus.Assigned;
        return roll < 0.10 ? JobStatus.Unassigned : roll < 0.30 ? JobStatus.Assigned : roll < 0.55 ? JobStatus.PickedUp : roll < 0.85 ? JobStatus.InTransit : JobStatus.Delivered;
    }

    private static void Advance(Job job, JobStatus target, int driverId, Random random, DateTime now)
    {
        if (target == JobStatus.Unassigned) return;
        job.DriverId = driverId;
        job.Status = target;

        var span = job.DueAt - job.ReadyAt;
        var finishedAt = job.ReadyAt + span * (0.45 + random.NextDouble() * 0.70);
        if (finishedAt > now) finishedAt = now;

        void Step(JobStatus status, double fraction, string note)
        {
            var at = job.ReadyAt + (finishedAt - job.ReadyAt) * fraction;
            job.Events.Add(new JobEvent { At = at < now ? at : now, Status = status, Note = note });
        }

        Step(JobStatus.Assigned, 0.05, "Assigned to driver");
        if (target >= JobStatus.PickedUp) Step(JobStatus.PickedUp, 0.3, "Picked up");
        if (target >= JobStatus.InTransit) Step(JobStatus.InTransit, 0.5, "In transit");
        if (target == JobStatus.Delivered)
        {
            job.DeliveredAt = finishedAt;
            Step(JobStatus.Delivered, 1, "Delivered");
        }
        if (target == JobStatus.Failed) Step(JobStatus.Failed, 1, "Delivery failed: nobody on site");
    }
}
