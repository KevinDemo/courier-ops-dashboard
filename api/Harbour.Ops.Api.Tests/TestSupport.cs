using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Harbour.Ops.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Harbour.Ops.Api.Tests;

public abstract class OpsFactory(bool seed) : WebApplicationFactory<Program>
{
    public const string NowUtc = "2026-11-04T04:00:00Z";
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly string _db = Path.Combine(Path.GetTempPath(), $"ops-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Database:Path", _db);
        builder.UseSetting("Clock:FixedUtc", NowUtc);
        builder.UseSetting("Seed:Enabled", seed.ToString());
        builder.UseSetting("Simulator:Enabled", "false");
    }

    public async Task<HttpClient> LoggedInClientAsync()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email = "ops@harbourfreight.example", password = "harbour-demo" });
        response.EnsureSuccessStatusCode();
        return client;
    }

    public void WithDb(Action<OpsDb> action)
    {
        using var scope = Services.CreateScope();
        action(scope.ServiceProvider.GetRequiredService<OpsDb>());
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_db);
    }
}

/// <summary>A full generated day, for paging, sorting and filtering.</summary>
public sealed class SeededFactory() : OpsFactory(seed: true);

/// <summary>Only the shared fixture's rows, so KPI answers are known exactly.</summary>
public sealed class FixtureFactory : OpsFactory
{
    public FixtureFactory() : base(seed: false)
    {
    }

    public JsonElement Fixture { get; } = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "kpi-fixture.json"))).RootElement;

    public void Load() => WithDb(db =>
    {
        if (db.Jobs.Any()) return;
        foreach (var row in Fixture.GetProperty("jobs").EnumerateArray())
        {
            db.Jobs.Add(new Job
            {
                Number = row.GetProperty("number").GetString()!,
                Customer = "Fixture",
                PickupSuburb = "A",
                DeliverySuburb = "B",
                Status = Enum.Parse<JobStatus>(row.GetProperty("status").GetString()!),
                ReadyAt = row.GetProperty("readyAt").GetDateTime().ToUniversalTime(),
                DueAt = row.GetProperty("dueAt").GetDateTime().ToUniversalTime(),
                DeliveredAt = row.GetProperty("deliveredAt").ValueKind == JsonValueKind.Null ? null : row.GetProperty("deliveredAt").GetDateTime().ToUniversalTime(),
            });
        }
        db.SaveChanges();
    });
}
