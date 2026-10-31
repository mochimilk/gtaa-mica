using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace GtaaMica.Secrets;

/// <summary>
/// Secrets kept in Windows Credential Manager, as generic credentials:
/// encrypted by Windows for this Windows account, kept on this computer
/// (CRED_PERSIST_LOCAL_MACHINE, so they don't roam with the profile), and
/// only ever read here, never handed to the page. The GitHub sign-in lives
/// here, and Skye's OpenAI key will too.
/// </summary>
internal static class CredentialStore
{
    /// <summary>Every credential's target starts with this, so they're easy to find (and remove) in Credential Manager.</summary>
    private const string Prefix = "GTAA Mica/";

    public sealed record Credential(string UserName, string Secret);

    /// <summary>The credential kept under <paramref name="name"/>, or null when there is none.</summary>
    public static Credential? Read(string name)
    {
        if (!CredRead(Prefix + name, CRED_TYPE_GENERIC, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ERROR_NOT_FOUND) return null;
            throw new Win32Exception(error);
        }
        try
        {
            var credential = Marshal.PtrToStructure<CREDENTIAL>(pointer);
            var secret = credential.CredentialBlobSize == 0
                ? ""
                : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
            return new Credential(credential.UserName ?? "", secret);
        }
        finally
        {
            CredFree(pointer);
        }
    }

    /// <summary>Keeps <paramref name="secret"/> under <paramref name="name"/>, in place of what was there.</summary>
    public static void Write(string name, string userName, string secret)
    {
        var blob = Encoding.Unicode.GetBytes(secret);
        var handle = GCHandle.Alloc(blob, GCHandleType.Pinned);
        try
        {
            var credential = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = Prefix + name,
                UserName = userName,
                CredentialBlob = handle.AddrOfPinnedObject(),
                CredentialBlobSize = (uint)blob.Length,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Array.Clear(blob);
            handle.Free();
        }
    }

    /// <summary>Removes what was kept under <paramref name="name"/>, if anything.</summary>
    public static void Delete(string name)
    {
        if (!CredDelete(Prefix + name, CRED_TYPE_GENERIC, 0))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != ERROR_NOT_FOUND) throw new Win32Exception(error);
        }
    }

    private const uint CRED_TYPE_GENERIC = 1;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2;
    private const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);
}
