# Payment API configuration

Manual payment proof URLs are optional. When a customer submits `proofUrl`, configure
`PAYMENT_PROOF_ALLOWED_HOSTS` as a comma-separated list of exact hostnames, for
example `payments.example.com,files.example.net`. The API accepts HTTPS URLs only,
rejects credentials in URLs, and requires an exact hostname match. If this variable
is absent or empty, proof URLs are rejected; submissions without a proof URL remain
available. No file upload or payment gateway integration is provided by this phase.
