using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using PptCOM;

namespace PptHttpWrapper;

internal static class Program
{
    private sealed record WorkItem(Func<PptCOMServer, object> Work, TaskCompletionSource<object> Tcs);

    private sealed class ComDispatcher : IAsyncDisposable
    {
        private readonly Channel<WorkItem> channel;
        private readonly CancellationTokenSource cts = new();
        private readonly Thread thread;

        public ComDispatcher()
        {
            channel = Channel.CreateBounded<WorkItem>(new BoundedChannelOptions(256)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.Wait
            });

            thread = new Thread(() => Run(cts.Token))
            {
                IsBackground = true,
                Name = "ppt-com-sta"
            };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
        }

        public bool TryEnqueue(Func<PptCOMServer, object> work, TaskCompletionSource<object> tcs)
        {
            return channel.Writer.TryWrite(new WorkItem(work, tcs));
        }

        private unsafe void Run(CancellationToken token)
        {
            var server = new PptCOMServer();

            var memTotal = Marshal.AllocHGlobal(sizeof(int));
            var memCurrent = Marshal.AllocHGlobal(sizeof(int));
            var memOff = Marshal.AllocHGlobal(sizeof(int));

            try
            {
                *(int*)memTotal = -1;
                *(int*)memCurrent = -1;
                *(int*)memOff = 0;
                server.Initialization((int*)memTotal, (int*)memCurrent, (int*)memOff);

                while (!token.IsCancellationRequested)
                {
                    WorkItem item;
                    try
                    {
                        if (!channel.Reader.WaitToReadAsync(token).AsTask().GetAwaiter().GetResult()) break;
                        if (!channel.Reader.TryRead(out item)) continue;
                    }
                    catch
                    {
                        break;
                    }

                    try
                    {
                        var result = item.Work(server);
                        item.Tcs.TrySetResult(result);
                    }
                    catch (Exception ex)
                    {
                        item.Tcs.TrySetException(ex);
                    }
                }
            }
            finally
            {
                try
                {
                    Marshal.FreeHGlobal(memTotal);
                    Marshal.FreeHGlobal(memCurrent);
                    Marshal.FreeHGlobal(memOff);
                }
                catch
                {
                }
            }
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                cts.Cancel();
            }
            catch
            {
            }

            try
            {
                channel.Writer.TryComplete();
            }
            catch
            {
            }

            await Task.Run(() =>
            {
                try
                {
                    if (thread.IsAlive) thread.Join(1500);
                }
                catch
                {
                }
            });
        }
    }

    private static int GetPort(string[] args)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] != "--port") continue;
            if (int.TryParse(args[i + 1], out var p) && p is > 0 and < 65536) return p;
        }

        var env = Environment.GetEnvironmentVariable("LANSTART_PPT_WRAPPER_PORT") ?? "";
        if (int.TryParse(env, out var ep) && ep is > 0 and < 65536) return ep;

        return 3133;
    }

    private static object BuildStatus(PptCOMServer server)
    {
        var ok = false;
        var total = -1;
        var current = -1;
        string name = "";
        long hwnd = 0;

        try
        {
            ok = server.TryGetSlideShowPageIndexTotal(out current, out total);
        }
        catch
        {
            ok = false;
        }

        try
        {
            name = server.SlideNameIndex() ?? "";
        }
        catch
        {
            name = "";
        }

        try
        {
            hwnd = server.GetPptHwnd().ToInt64();
        }
        catch
        {
            hwnd = 0;
        }

        return new { ok, currentPage = current, totalPage = total, slideNameIndex = name, hwnd };
    }

    public static async Task<int> Main(string[] args)
    {
        var port = GetPort(args);
        var url = $"http://127.0.0.1:{port}";

        await using var dispatcher = new ComDispatcher();

        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.UseUrls(url);
        var app = builder.Build();

        app.MapGet("/health", () => Results.Json(new { ok = true }));

        app.MapGet("/ppt/check", async () =>
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!dispatcher.TryEnqueue((server) => new { ok = true, version = server.CheckCOM() }, tcs))
                return Results.Json(new { ok = false, error = "BUSY" });

            try
            {
                var res = await tcs.Task.ConfigureAwait(false);
                return Results.Json(res);
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message });
            }
        });

        app.MapGet("/ppt/status", async () =>
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!dispatcher.TryEnqueue((server) => BuildStatus(server), tcs))
                return Results.Json(new { ok = false, error = "BUSY" });

            try
            {
                var res = await tcs.Task.ConfigureAwait(false);
                return Results.Json(res);
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message });
            }
        });

        app.MapPost("/ppt/next", async (HttpRequest req) =>
        {
            var check = false;
            try
            {
                if (req.ContentLength > 0)
                {
                    using var json = await JsonDocument.ParseAsync(req.Body).ConfigureAwait(false);
                    if (json.RootElement.TryGetProperty("check", out var p) && p.ValueKind == JsonValueKind.True) check = true;
                }
            }
            catch
            {
            }

            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!dispatcher.TryEnqueue((server) =>
            {
                server.EnsureBoundToActivePowerPoint();
                server.NextSlideShow(check);
                return BuildStatus(server);
            }, tcs))
                return Results.Json(new { ok = false, error = "BUSY" });

            try
            {
                var res = await tcs.Task.ConfigureAwait(false);
                return Results.Json(res);
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message });
            }
        });

        app.MapPost("/ppt/prev", async () =>
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!dispatcher.TryEnqueue((server) =>
            {
                server.EnsureBoundToActivePowerPoint();
                server.PreviousSlideShow();
                return BuildStatus(server);
            }, tcs))
                return Results.Json(new { ok = false, error = "BUSY" });

            try
            {
                var res = await tcs.Task.ConfigureAwait(false);
                return Results.Json(res);
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message });
            }
        });

        app.MapPost("/ppt/end", async () =>
        {
            var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!dispatcher.TryEnqueue((server) =>
            {
                server.EnsureBoundToActivePowerPoint();
                server.EndSlideShow();
                return BuildStatus(server);
            }, tcs))
                return Results.Json(new { ok = false, error = "BUSY" });

            try
            {
                var res = await tcs.Task.ConfigureAwait(false);
                return Results.Json(res);
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message });
            }
        });

        await app.RunAsync().ConfigureAwait(false);
        return 0;
    }
}
