using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Discovery only. This host never accesses cookies, pages or either business DB.
// A native port keeps the Chrome worker alive; the APP owns the HTTP connection.
internal static class SignalDeskFollowingHost
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static byte[] Read(Stream stream, int count)
    {
        byte[] bytes = new byte[count]; int offset = 0;
        while (offset < count) { int n = stream.Read(bytes, offset, count - offset); if (n == 0) return null; offset += n; }
        return bytes;
    }
    public static int Main()
    {
        Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
        while (true)
        {
            byte[] header = Read(input, 4); if (header == null) return 0;
            int length = BitConverter.ToInt32(header, 0); if (length < 1 || length > 4096) return 1;
            byte[] body = Read(input, length); if (body == null) return 0;
            object result;
            try
            {
                var request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                if (!request.ContainsKey("type") || Convert.ToString(request["type"]) != "discover") throw new Exception("Unknown message");
                string root = AppDomain.CurrentDomain.BaseDirectory;
                var config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "discovery-path.json"), Encoding.UTF8));
                var discovery = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Convert.ToString(config["path"]), Encoding.UTF8));
                Uri origin = new Uri(Convert.ToString(discovery["origin"]));
                if (origin.Scheme != "http" || origin.Host != "127.0.0.1") throw new Exception("Invalid APP origin");
                result = new { ok = true, discovery = discovery };
            }
            catch (Exception error) { result = new { ok = false, error = error.Message }; }
            byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(result));
            output.Write(BitConverter.GetBytes(payload.Length), 0, 4); output.Write(payload, 0, payload.Length); output.Flush();
        }
    }
}
