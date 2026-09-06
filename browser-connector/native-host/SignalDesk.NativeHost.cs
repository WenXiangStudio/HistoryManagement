using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

internal static class SignalDeskNativeHost
{
    private const int MaximumMessageBytes = 8 * 1024 * 1024;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaximumMessageBytes };

    private static byte[] ReadExact(Stream input, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int read = input.Read(buffer, offset, length - offset);
            if (read == 0) return null;
            offset += read;
        }
        return buffer;
    }

    private static Dictionary<string, object> ReadMessage(Stream input)
    {
        byte[] header = ReadExact(input, 4);
        if (header == null) return null;
        int length = BitConverter.ToInt32(header, 0);
        if (length <= 0 || length > MaximumMessageBytes) throw new InvalidDataException("Invalid native message length");
        byte[] payload = ReadExact(input, length);
        if (payload == null) return null;
        return Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(payload));
    }

    private static void WriteMessage(Stream output, object value)
    {
        byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(value));
        byte[] header = BitConverter.GetBytes(payload.Length);
        output.Write(header, 0, header.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static Dictionary<string, object> LoadDiscovery()
    {
        string appData = Environment.GetEnvironmentVariable("APPDATA");
        if (String.IsNullOrWhiteSpace(appData)) appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string[] candidates = {
            Path.Combine(appData, "Signal Desk", "bridge.json"),
            Path.Combine(appData, "signal-desk", "bridge.json")
        };
        foreach (string path in candidates)
        {
            try
            {
                if (!File.Exists(path)) continue;
                Dictionary<string, object> value = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
                string url = value.ContainsKey("url") ? Convert.ToString(value["url"]) : "";
                string secret = value.ContainsKey("secret") ? Convert.ToString(value["secret"]) : "";
                Uri parsed;
                if (!Uri.TryCreate(url, UriKind.Absolute, out parsed)) continue;
                if (parsed.Scheme != "http" || parsed.Host != "127.0.0.1" || parsed.Port <= 0 || String.IsNullOrWhiteSpace(secret)) continue;
                return value;
            }
            catch
            {
                // A stale or partially written discovery file is treated as offline.
            }
        }
        return null;
    }

    private static Dictionary<string, object> Proxy(Dictionary<string, object> message)
    {
        Dictionary<string, object> discovery = LoadDiscovery();
        if (discovery == null) return Error("请先启动 Signal Desk 桌面端");

        string type = message.ContainsKey("type") ? Convert.ToString(message["type"]) : "";
        string endpoint;
        string method;
        if (type == "poll") { endpoint = "/v1/commands"; method = "GET"; }
        else if (type == "event") { endpoint = "/v1/events"; method = "POST"; }
        else if (type == "status") { endpoint = "/v1/status"; method = "POST"; }
        else return Error("Unknown connector message type");

        string baseUrl = Convert.ToString(discovery["url"]);
        string secret = Convert.ToString(discovery["secret"]);
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + endpoint);
        request.Method = method;
        request.Timeout = 20000;
        request.ReadWriteTimeout = 20000;
        request.Headers["x-signaldesk-secret"] = secret;
        request.KeepAlive = false;
        if (method == "POST")
        {
            request.ContentType = "application/json";
            object body = message.ContainsKey("payload") ? message["payload"] : new Dictionary<string, object>();
            byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
            request.ContentLength = bytes.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        }

        try
        {
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) return Response(response, true, null);
        }
        catch (WebException error)
        {
            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response != null) { using (response) return Response(response, false, error.Message); }
            return Error("桌面端连接失败：" + error.Message);
        }
    }

    private static Dictionary<string, object> Response(HttpWebResponse response, bool ok, string fallbackError)
    {
        string text = "";
        using (Stream stream = response.GetResponseStream())
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) text = reader.ReadToEnd();
        object body = null;
        try { body = String.IsNullOrWhiteSpace(text) ? null : Json.DeserializeObject(text); } catch { body = null; }
        return new Dictionary<string, object> {
            { "ok", ok }, { "status", (int)response.StatusCode }, { "body", body },
            { "error", ok ? null : (String.IsNullOrWhiteSpace(text) ? fallbackError : text.Substring(0, Math.Min(500, text.Length))) }
        };
    }

    private static Dictionary<string, object> Error(string message)
    {
        return new Dictionary<string, object> { { "ok", false }, { "error", message } };
    }

    public static int Main()
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();
        while (true)
        {
            try
            {
                Dictionary<string, object> message = ReadMessage(input);
                if (message == null) return 0;
                WriteMessage(output, Proxy(message));
            }
            catch (Exception error)
            {
                try { WriteMessage(output, Error(error.Message)); }
                catch { return 1; }
            }
        }
    }
}
