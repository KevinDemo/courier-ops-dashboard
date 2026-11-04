using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Harbour.Ops.Api.Tests;

public class AuthAndLiveTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    private HttpClient Anonymous() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    [Theory]
    [InlineData("/api/kpis")]
    [InlineData("/api/jobs")]
    [InlineData("/api/jobs/1")]
    [InlineData("/api/charts/hourly")]
    [InlineData("/api/drivers")]
    [InlineData("/api/auth/me")]
    public async Task Data_needs_a_login_and_answers_401_not_a_redirect(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Anonymous().GetAsync(path)).StatusCode);

    [Fact]
    public async Task Simulator_tick_needs_a_login() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Anonymous().PostAsync("/api/simulator/tick", null)).StatusCode);

    [Theory]
    [InlineData("ops@harbourfreight.example", "wrong")]
    [InlineData("someone@else.example", "harbour-demo")]
    [InlineData("", "")]
    public async Task Bad_login_is_refused(string email, string password)
    {
        var client = Anonymous();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/kpis")).StatusCode);
    }

    [Fact]
    public async Task Login_cookie_is_http_only_and_strict()
    {
        var response = await Anonymous().PostAsJsonAsync("/api/auth/login", new { email = "ops@harbourfreight.example", password = "harbour-demo" });
        var cookie = response.Headers.GetValues("Set-Cookie").Single();
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        var client = await factory.LoggedInClientAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/kpis")).StatusCode);
        await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/kpis")).StatusCode);
    }

    [Fact]
    public async Task Tick_moves_one_job_one_step_records_it_and_pushes_it_to_a_connected_client()
    {
        var login = await factory.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "ops@harbourfreight.example", password = "harbour-demo" });
        var cookie = login.Headers.GetValues("Set-Cookie").Single().Split(';')[0];

        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/ops"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.Headers["Cookie"] = cookie;
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()))
            .Build();

        var received = new TaskCompletionSource<JobChanged>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JobChanged>("jobChanged", change => received.TrySetResult(change));
        await connection.StartAsync();

        var simulator = factory.Services.GetRequiredService<JobSimulator>();
        var change = await simulator.TickAsync(default);

        var pushed = await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(change!.Id, pushed.Id);
        Assert.Equal(change.Status, pushed.Status);

        factory.WithDb(db =>
        {
            var events = db.JobEvents.AsNoTracking().Where(e => e.JobId == pushed.Id).OrderBy(e => e.Id).ToList();
            Assert.Equal(pushed.Status, events[^1].Status);
        });
    }

    [Fact]
    public async Task Hub_refuses_an_anonymous_client()
    {
        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/ops"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();

        await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
    }

    [Theory]
    [InlineData(JobStatus.Unassigned, JobStatus.Assigned)]
    [InlineData(JobStatus.Assigned, JobStatus.PickedUp)]
    [InlineData(JobStatus.PickedUp, JobStatus.InTransit)]
    public void Workflow_moves_forward_one_step(JobStatus from, JobStatus to) =>
        Assert.Equal(to, JobRules.Next(from, new Random(1)));

    [Theory]
    [InlineData(JobStatus.Delivered)]
    [InlineData(JobStatus.Failed)]
    public void Finished_jobs_do_not_move(JobStatus status) =>
        Assert.Null(JobRules.Next(status, new Random(1)));
}
