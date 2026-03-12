CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  tier INT CHECK (tier IN (1, 2, 3)),
  language TEXT,
  repo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slack_channel TEXT,
  oncall_rotation TEXT
);

CREATE TABLE service_ownership (
  service_id UUID REFERENCES services(id),
  team_id UUID REFERENCES teams(id),
  PRIMARY KEY (service_id, team_id)
);

CREATE TABLE service_dependencies (
  from_service_id UUID REFERENCES services(id),
  to_service_id UUID REFERENCES services(id),
  dependency_type TEXT DEFAULT 'sync',
  PRIMARY KEY (from_service_id, to_service_id)
);

CREATE TABLE runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT,
  tags TEXT[],
  content TEXT
);

CREATE TABLE service_runbooks (
  service_id UUID REFERENCES services(id),
  runbook_id UUID REFERENCES runbooks(id),
  PRIMARY KEY (service_id, runbook_id)
);

CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id),
  version TEXT,
  commit_sha TEXT,
  deployed_at TIMESTAMPTZ DEFAULT now(),
  deployer TEXT
);

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  root_cause TEXT,
  resolution TEXT,
  occurred_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE incident_services (
  incident_id UUID REFERENCES incidents(id),
  service_id UUID REFERENCES services(id),
  PRIMARY KEY (incident_id, service_id)
);
