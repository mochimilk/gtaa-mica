using System.Text.Json.Serialization;
using Planning.Application;
using Planning.Application.Http;
using Planning.Assistant;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.AddSingleton<IPlanningActorResolver, DevelopmentHeaderActorResolver>();
builder.Services.AddSingleton(_ => LocalFixture.CreateApplication());
builder.Services.AddSingleton(_ => LocalFixture.CreateAssistant());

WebApplication app = builder.Build();
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "planning-application-http",
    mode = "local-fixture"
}));
app.MapPlanningHttpEndpoints();
app.MapAssistantHttpEndpoints();
app.Run();
