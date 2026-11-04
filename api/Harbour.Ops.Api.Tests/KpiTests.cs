using System.Net.Http.Json;

namespace Harbour.Ops.Api.Tests;

/// <summary>The numbers a manager acts on. Boundaries come from the fixture shared with the front end.</summary>
public class KpiTests(FixtureFactory factory) : IClassFixture<FixtureFactory>
{
    [Fact]
    public async Task Kpis_match_the_shared_fixture()
    {
        factory.Load();
        var client = await factory.LoggedInClientAsync();
        var kpis = await client.GetFromJsonAsync<Kpis>("/api/kpis", OpsFactory.Json);
        var expected = factory.Fixture.GetProperty("expected");

        Assert.Equal(expected.GetProperty("jobsToday").GetInt32(), kpis!.JobsToday);
        Assert.Equal(expected.GetProperty("delivered").GetInt32(), kpis.Delivered);
        Assert.Equal(expected.GetProperty("onTimePercent").GetDouble(), kpis.OnTimePercent);
        Assert.Equal(expected.GetProperty("late").GetInt32(), kpis.Late);
        Assert.Equal(expected.GetProperty("unassigned").GetInt32(), kpis.Unassigned);
        Assert.Equal(expected.GetProperty("failed").GetInt32(), kpis.Failed);
    }

    [Fact]
    public async Task Hourly_chart_accounts_for_every_job_today_exactly_once()
    {
        factory.Load();
        var client = await factory.LoggedInClientAsync();
        var hours = (await client.GetFromJsonAsync<List<HourBucket>>("/api/charts/hourly", OpsFactory.Json))!;

        Assert.Equal(8, hours.Sum(h => h.OnTime + h.Late + h.Open + h.Failed));
        Assert.Equal(2, hours.Sum(h => h.OnTime));
        Assert.Equal(3, hours.Sum(h => h.Late));
        Assert.Equal(2, hours.Sum(h => h.Open));
        Assert.Equal(1, hours.Sum(h => h.Failed));
    }

    [Fact]
    public async Task Hours_are_depot_local_with_no_gaps()
    {
        factory.Load();
        var client = await factory.LoggedInClientAsync();
        var hours = await client.GetFromJsonAsync<List<HourBucket>>("/api/charts/hourly", OpsFactory.Json);

        // 22:00 UTC on 3 November is 09:00 in Sydney at UTC+11. The last job is ready at 14:00 local.
        Assert.Equal(Enumerable.Range(9, 6), hours!.Select(h => h.Hour));
    }

    [Fact]
    public async Task Late_filter_returns_the_same_jobs_the_tile_counts()
    {
        factory.Load();
        var client = await factory.LoggedInClientAsync();
        var page = await client.GetFromJsonAsync<PagedJobs>("/api/jobs?lateOnly=true", OpsFactory.Json);

        Assert.Equal(3, page!.Total);
        Assert.All(page.Items, row => Assert.True(row.IsLate));
        Assert.DoesNotContain(page.Items, row => row.Number.StartsWith("T2") || row.Number.StartsWith("T8"));
    }
}
