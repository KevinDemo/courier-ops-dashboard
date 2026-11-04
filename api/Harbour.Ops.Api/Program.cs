using System.Security.Claims;
using System.Text.Json.Serialization;
using Harbour.Ops.Api;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

TimeProvider clock = config["Clock:FixedUtc"] is { Length: > 0 } fixedUtc ? new FixedClock(DateTimeOffset.Parse(fixedUtc)) : TimeProvider.System;
builder.Services.AddSingleton(clock);
builder.Services.AddSingleton(new OpsCalendar(clock, TimeZoneInfo.FindSystemTimeZoneById(config["Ops:TimeZone"] ?? "Australia/Sydney")));

var dbPath = Path.GetFullPath(config["Database:Path"] ?? "data/ops.db", AppContext.BaseDirectory);
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
builder.Services.AddDbContext<OpsDb>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddScoped<OpsQueries>();
builder.Services.AddSingleton<JobSimulator>();
if (config.GetValue("Simulator:Enabled", true)) builder.Services.AddHostedService<SimulatorService>();

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "harbour.ops";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.SlidingExpiration = true;
    o.ExpireTimeSpan = TimeSpan.FromHours(10);
    // An API answers 401. It does not redirect to a login page.
    o.Events.OnRedirectToLogin = context => { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OpsDb>();
    db.Database.EnsureCreated();
    if (config.GetValue("Seed:Enabled", true)) Seeder.EnsureToday(db, scope.ServiceProvider.GetRequiredService<OpsCalendar>());
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

// One demo user, named in the README. The hash is still checked properly, so the flow is the real one.
var demoEmail = config["DemoUser:Email"]!;
var hasher = new PasswordHasher<string>();
var demoHash = hasher.HashPassword(demoEmail, config["DemoUser:Password"]!);

app.MapPost("/api/auth/login", async Task<Results<Ok<UserDto>, UnauthorizedHttpResult>> (LoginRequest request, HttpContext http) =>
{
    var emailOk = string.Equals(request.Email, demoEmail, StringComparison.OrdinalIgnoreCase);
    var passwordOk = hasher.VerifyHashedPassword(demoEmail, demoHash, request.Password ?? "") != PasswordVerificationResult.Failed;
    if (!emailOk || !passwordOk) return TypedResults.Unauthorized();

    var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, demoEmail)], CookieAuthenticationDefaults.AuthenticationScheme);
    await http.SignInAsync(new ClaimsPrincipal(identity));
    return TypedResults.Ok(new UserDto(demoEmail));
});

app.MapPost("/api/auth/logout", async (HttpContext http) =>
{
    await http.SignOutAsync();
    return Results.NoContent();
});

var api = app.MapGroup("/api").RequireAuthorization();

api.MapGet("/auth/me", (ClaimsPrincipal user) => new UserDto(user.Identity!.Name!));

api.MapGet("/kpis", (OpsQueries queries, CancellationToken ct) => queries.GetKpisAsync(ct));

api.MapGet("/charts/hourly", (OpsQueries queries, CancellationToken ct) => queries.GetHourlyAsync(ct));

api.MapGet("/drivers", (OpsDb db, CancellationToken ct) =>
    db.Drivers.AsNoTracking().OrderBy(d => d.Name).Select(d => new { d.Id, d.Name }).ToListAsync(ct));

api.MapGet("/jobs", async ([AsParameters] JobQuery query, OpsQueries queries, CancellationToken ct) =>
{
    if (query.Sort is not null && !OpsQueries.SortableColumns.Contains(query.Sort))
    {
        return Results.Problem($"Cannot sort by '{query.Sort}'.", statusCode: StatusCodes.Status400BadRequest);
    }
    return Results.Ok(await queries.GetJobsAsync(query, ct));
});

api.MapGet("/jobs/{id:int}", async (int id, OpsQueries queries, CancellationToken ct) =>
    await queries.GetJobAsync(id, ct) is { } job ? Results.Ok(job) : Results.NotFound());

api.MapPost("/simulator/tick", async (JobSimulator simulator, CancellationToken ct) => Results.Ok(await simulator.TickAsync(ct)));

app.MapHub<OpsHub>("/hubs/ops");

// The built front end, when it has been copied into wwwroot.
app.MapFallbackToFile("index.html");

app.Run();

public sealed record LoginRequest(string? Email, string? Password);
public sealed record UserDto(string Email);

public partial class Program;
