using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace Harbour.Ops.Api.Tests;

public class JobsApiTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    private async Task<PagedJobs> Get(string query)
    {
        var client = await factory.LoggedInClientAsync();
        return (await client.GetFromJsonAsync<PagedJobs>($"/api/jobs?{query}", OpsFactory.Json))!;
    }

    [Fact]
    public async Task Paging_returns_every_job_exactly_once()
    {
        var seen = new List<string>();
        for (var page = 1; page <= 7; page++) seen.AddRange((await Get($"page={page}&pageSize=25")).Items.Select(j => j.Number));

        Assert.Equal(Seeder.JobsPerDay, seen.Count);
        Assert.Equal(seen.Count, seen.Distinct().Count());
    }

    [Theory]
    [InlineData("pageSize=100000", 100)]
    [InlineData("pageSize=0", 1)]
    [InlineData("pageSize=-5", 1)]
    public async Task Page_size_is_clamped(string query, int expected) =>
        Assert.Equal(expected, (await Get(query)).PageSize);

    [Fact]
    public async Task Page_past_the_end_is_empty_and_keeps_the_total()
    {
        var result = await Get("page=999");
        Assert.Empty(result.Items);
        Assert.Equal(Seeder.JobsPerDay, result.Total);
    }

    [Theory]
    [InlineData("number")]
    [InlineData("customer")]
    public async Task Sorting_is_done_by_the_server_in_both_directions(string column)
    {
        string Key(JobRow row) => column == "number" ? row.Number : row.Customer;
        var ascending = (await Get($"sort={column}&dir=asc&pageSize=100")).Items.Select(Key).ToList();
        var descending = (await Get($"sort={column}&dir=desc&pageSize=100")).Items.Select(Key).ToList();

        Assert.Equal(ascending.Order(StringComparer.Ordinal), ascending);
        Assert.Equal(descending.OrderDescending(StringComparer.Ordinal), descending);
    }

    [Fact]
    public async Task Sorting_by_status_follows_the_workflow_not_the_alphabet()
    {
        var statuses = (await Get("sort=status&dir=asc&pageSize=100")).Items.Select(j => (int)j.Status).ToList();
        Assert.Equal(statuses.Order(), statuses);
    }

    [Fact]
    public async Task Sorting_by_an_unknown_column_is_refused_not_passed_to_sql()
    {
        var client = await factory.LoggedInClientAsync();
        var response = await client.GetAsync("/api/jobs?sort=Password;DROP TABLE Jobs");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Filters_combine_and_the_total_reflects_them()
    {
        var all = await Get("pageSize=100");
        var expected = (await Task.WhenAll(Enumerable.Range(1, 2).Select(p => Get($"page={p}&pageSize=100")))).SelectMany(r => r.Items)
            .Count(j => j.Status == JobStatus.Delivered && j.Service == ServiceLevel.Express);

        var filtered = await Get("status=Delivered&service=Express&pageSize=100");

        Assert.True(expected > 0, "The seed should contain delivered express jobs.");
        Assert.Equal(expected, filtered.Total);
        Assert.True(filtered.Total < all.Total);
        Assert.All(filtered.Items, j => { Assert.Equal(JobStatus.Delivered, j.Status); Assert.Equal(ServiceLevel.Express, j.Service); });
    }

    [Fact]
    public async Task Search_matches_number_customer_and_suburb_in_any_case()
    {
        Assert.Contains((await Get("q=BELLBIRD&pageSize=100")).Items, j => j.Customer == "Bellbird Ceramics");
        Assert.Equal(1, (await Get("q=HF261104001")).Total);
        Assert.All((await Get("q=tern%20bay&pageSize=100")).Items, j =>
            Assert.True(j.Customer.Contains("Tern Bay") || j.PickupSuburb == "Tern Bay" || j.DeliverySuburb == "Tern Bay"));
    }

    [Fact]
    public async Task Search_treats_sql_wildcards_as_plain_text()
    {
        Assert.Equal(0, (await Get("q=%25")).Total);
        Assert.Equal(0, (await Get("q=';DROP TABLE Jobs;--")).Total);
        Assert.Equal(Seeder.JobsPerDay, (await Get("")).Total);
    }

    [Fact]
    public async Task Driver_filter_returns_only_that_driver()
    {
        var client = await factory.LoggedInClientAsync();
        var drivers = await client.GetFromJsonAsync<List<DriverDto>>("/api/drivers", OpsFactory.Json);
        var page = await Get($"driverId={drivers![0].Id}&pageSize=100");
        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, j => Assert.Equal(drivers[0].Name, j.Driver));
    }

    [Fact]
    public async Task Job_detail_has_a_timeline_in_order()
    {
        var delivered = (await Get("status=Delivered")).Items[0];
        var client = await factory.LoggedInClientAsync();
        var detail = await client.GetFromJsonAsync<JobDetail>($"/api/jobs/{delivered.Id}", OpsFactory.Json);

        Assert.Equal(delivered.Number, detail!.Job.Number);
        Assert.Equal(JobStatus.Unassigned, detail.Events[0].Status);
        Assert.Equal(JobStatus.Delivered, detail.Events[^1].Status);
        Assert.Equal(detail.Events.Select(e => e.At).Order(), detail.Events.Select(e => e.At));
        Assert.NotNull(detail.Vehicle);
    }

    [Fact]
    public void Generated_history_never_happens_after_the_current_time()
    {
        var now = DateTime.Parse(OpsFactory.NowUtc).ToUniversalTime();
        _ = factory.Services;
        factory.WithDb(db =>
        {
            Assert.Empty(db.JobEvents.AsNoTracking().Where(e => e.At > now));
            Assert.Empty(db.Jobs.AsNoTracking().Where(j => j.DeliveredAt > now));
        });
    }

    [Fact]
    public async Task Unknown_job_is_404()
    {
        var client = await factory.LoggedInClientAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/jobs/99999")).StatusCode);
    }

    [Fact]
    public async Task Times_are_sent_as_utc()
    {
        var client = await factory.LoggedInClientAsync();
        var raw = await client.GetStringAsync("/api/jobs?pageSize=1");
        Assert.Matches("\"dueAt\":\"[^\"]+Z\"", raw);
    }

    [Fact]
    public void Generator_gives_the_same_day_for_the_same_date_and_clock()
    {
        string Snapshot(SeededFactory f)
        {
            var text = "";
            f.WithDb(db => text = string.Join("|", db.Jobs.AsNoTracking().OrderBy(j => j.Number).Select(j => $"{j.Number},{j.Customer},{j.Status},{j.DueAt:O}")));
            return text;
        }

        using var first = new SeededFactory();
        using var second = new SeededFactory();
        _ = first.Services;
        _ = second.Services;
        Assert.Equal(Snapshot(first), Snapshot(second));
    }

    private sealed record DriverDto(int Id, string Name);
}
