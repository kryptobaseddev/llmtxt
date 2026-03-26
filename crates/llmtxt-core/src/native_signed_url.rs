use crate::compute_signature_with_length;

/// Parameters extracted from a verified signed URL.
#[derive(Debug)]
pub struct SignedUrlParams {
    /// Document slug.
    pub slug: String,
    /// Agent that was granted access.
    pub agent_id: String,
    /// Conversation scope.
    pub conversation_id: String,
    /// Expiration timestamp in milliseconds.
    pub expires_at: u64,
}

/// Errors that can occur during signed URL verification.
#[derive(Debug)]
pub enum VerifyError {
    /// Required query parameters are missing or malformed.
    MissingParams,
    /// The URL has expired.
    Expired,
    /// The HMAC signature does not match.
    InvalidSignature,
}

/// Input for generating a signed URL in native Rust consumers.
pub struct SignedUrlBuildRequest<'a> {
    /// Base API origin such as `https://api.example.com`.
    pub base_url: &'a str,
    /// Optional resource path prefix such as `attachments`.
    pub path_prefix: &'a str,
    /// Document slug.
    pub slug: &'a str,
    /// Agent that is granting access.
    pub agent_id: &'a str,
    /// Conversation scope.
    pub conversation_id: &'a str,
    /// Expiration timestamp in milliseconds.
    pub expires_at: u64,
    /// Signing secret.
    pub secret: &'a str,
    /// Signature length in hex characters.
    pub sig_length: usize,
}

/// Generate a signed URL with an optional resource path prefix. Native Rust API only.
///
/// Use `path_prefix` such as `"attachments"` to produce
/// `https://host/attachments/{slug}?agent=...`.
///
/// # Errors
/// Returns an error string if `base_url` is invalid.
pub fn generate_signed_url(request: &SignedUrlBuildRequest<'_>) -> Result<String, String> {
    let mut url =
        url::Url::parse(request.base_url).map_err(|e| format!("invalid base url: {e}"))?;
    let normalized_prefix = request.path_prefix.trim_matches('/');
    let path = if normalized_prefix.is_empty() {
        format!("/{}", request.slug)
    } else {
        format!("/{normalized_prefix}/{}", request.slug)
    };
    url.set_path(&path);

    let signature = compute_signature_with_length(
        request.slug,
        request.agent_id,
        request.conversation_id,
        request.expires_at as f64,
        request.secret,
        request.sig_length,
    );

    url.query_pairs_mut()
        .append_pair("agent", request.agent_id)
        .append_pair("conv", request.conversation_id)
        .append_pair("exp", &request.expires_at.to_string())
        .append_pair("sig", &signature);

    Ok(url.into())
}

/// Verify a signed URL. Native Rust API only.
///
/// # Errors
/// Returns `VerifyError` if the URL is invalid, expired, or has a bad signature.
pub fn verify_signed_url(input: &str, secret: &str) -> Result<SignedUrlParams, VerifyError> {
    let parsed = url::Url::parse(input).map_err(|_| VerifyError::MissingParams)?;

    let slug = parsed
        .path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
        .map(str::to_string)
        .ok_or(VerifyError::MissingParams)?;

    let get_param = |name: &str| -> Result<String, VerifyError> {
        parsed
            .query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.to_string())
            .ok_or(VerifyError::MissingParams)
    };

    let agent = get_param("agent")?;
    let conv = get_param("conv")?;
    let exp_str = get_param("exp")?;
    let sig = get_param("sig")?;

    let expires_at: u64 = exp_str.parse().map_err(|_| VerifyError::MissingParams)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if now > expires_at {
        return Err(VerifyError::Expired);
    }

    let expected =
        compute_signature_with_length(&slug, &agent, &conv, expires_at as f64, secret, sig.len());
    if sig != expected {
        return Err(VerifyError::InvalidSignature);
    }

    Ok(SignedUrlParams {
        slug,
        agent_id: agent,
        conversation_id: conv,
        expires_at,
    })
}
