"""Shared deterministic source/history checks; never include real secret values."""
import re

RULES = {
    'private-key-material': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\[nr])+[A-Za-z0-9+/=]{64}'),
    'github-token': re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}'),
    'aws-access-id': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'google-api-key': re.compile(rb'AIza[A-Za-z0-9_-]{35}'),
    'google-oauth-id': re.compile(rb'\b[0-9]{8,}-[a-z0-9]+\.apps\.googleusercontent\.com'),
    'personal-home-path': re.compile(rb'(?i)C:[\\/]Users[\\/](?!OPERATOR(?:[\\/]|$))[^\s\x00]+'),
    'tailnet-host': re.compile(rb'\b[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net\b'),
}


def findings(data):
    return [name for name, pattern in RULES.items() if pattern.search(data)]
