// Profile discovery and the connection for this tab are independent.
export async function readVpnAvailability(api, { sessionId, previous, onProfiles }) {
  const options = { timeoutMs: 8000 };
  const connection = sessionId
    ? api(`/api/vpn/session?sid=${encodeURIComponent(sessionId)}`, options).then(
      info => ({ info, connected: !!info.connected, profile: info.profile || null, sessionError: "" }),
      () => ({ info: null, connected: false, profile: null, sessionError: "Couldn't check this session's connection." })
    )
    : Promise.resolve({ info: null, connected: false, profile: null, sessionError: "" });

  let status = null;
  let error = "";
  try {
    status = await api("/api/vpn/status", options);
    if (!Array.isArray(status?.profiles) || !status.profiles.length) {
      const catalog = await api("/api/vpn/profiles", options);
      if (!Array.isArray(catalog?.profiles)) throw new Error("The server did not return a VPN exit list.");
      status = { ...status, ...catalog, enabled: catalog.enabled ?? status?.enabled };
    }
  } catch (failure) {
    if (!status) {
      try {
        const catalog = await api("/api/vpn/profiles", options);
        if (!Array.isArray(catalog?.profiles)) throw new Error("The server did not return a VPN exit list.");
        status = catalog;
      } catch { error = "Couldn't load configured VPN exits. Try again."; }
    } else {
      error = "Couldn't refresh the VPN exit list. Try again.";
    }
    if (error && previous?.profiles?.length) status = previous;
  }
  onProfiles?.({ status, error });
  return { status, error, ...await connection };
}
