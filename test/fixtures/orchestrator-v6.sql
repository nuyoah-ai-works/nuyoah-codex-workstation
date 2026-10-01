-- Empty schema captured from v6; synthetic test data only.
CREATE TABLE candidate_refs (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            candidate_ref TEXT NOT NULL CHECK (length(candidate_ref) BETWEEN 1 AND 1000),
            candidate_fingerprint TEXT NOT NULL,
            asset_version TEXT NOT NULL,
            governance_source_id TEXT NOT NULL,
            source_status TEXT NOT NULL CHECK (source_status IN ('connected', 'stale', 'unavailable')),
            candidate_status TEXT NOT NULL CHECK (candidate_status IN (
              'draft', 'queued', 'evaluating', 'accepted', 'revalidation_required', 'rejected', 'held', 'expired'
            )),
            validation_status TEXT NOT NULL CHECK (validation_status IN ('PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED')),
            qualification_status TEXT NOT NULL CHECK (qualification_status IN ('eligible', 'ineligible', 'unknown')),
            environment_fingerprint TEXT NOT NULL,
            promotion_destination TEXT NOT NULL CHECK (promotion_destination IN (
              'single_case', 'project_memory', 'project_rule', 'domain_rule_or_skill', 'personal_global_skill', 'unknown'
            )),
            canonical_ref TEXT,
            activation_mode TEXT NOT NULL CHECK (activation_mode IN ('separate', 'write_is_activation')),
            local_record_status TEXT NOT NULL CHECK (local_record_status IN (
              'not_recorded', 'approved', 'recorded', 'rolled_back'
            )),
            enable_status TEXT NOT NULL CHECK (enable_status IN ('not_enabled', 'enabled', 'suspended', 'rolled_back')),
            publish_status TEXT NOT NULL CHECK (publish_status IN ('not_published', 'published', 'rolled_back')),
            value_gate_stage TEXT NOT NULL CHECK (value_gate_stage IN ('M0', 'M3', 'M6', 'M12')),
            value_gate_decision TEXT NOT NULL CHECK (value_gate_decision IN ('GO', 'PAUSE', 'ROLLBACK', 'RETIRE')),
            capacity_status TEXT NOT NULL CHECK (capacity_status IN ('available', 'full', 'unknown')),
            routing_eligible INTEGER NOT NULL CHECK (routing_eligible IN (0, 1)),
            budget_locked INTEGER NOT NULL CHECK (budget_locked IN (0, 1)),
            sample_plan_locked INTEGER NOT NULL CHECK (sample_plan_locked IN (0, 1)),
            pilot_cluster_locked INTEGER NOT NULL CHECK (pilot_cluster_locked IN (0, 1)),
            rollback_sla_locked INTEGER NOT NULL CHECK (rollback_sla_locked IN (0, 1)),
            governance_endpoint_locked INTEGER NOT NULL CHECK (governance_endpoint_locked IN (0, 1)),
            orchestrator_route_blocked_at TEXT,
            canonical_source_rolled_back_at TEXT,
            fresh_session_no_load_verified_at TEXT,
            last_trusted_at TEXT,
            read_error_code TEXT,
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
            updated_at TEXT NOT NULL,
            UNIQUE (request_id, candidate_ref)
          );

CREATE TABLE dispatch_dependencies (
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            depends_on_dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
            PRIMARY KEY (dispatch_id, depends_on_dispatch_id),
            CHECK (dispatch_id <> depends_on_dispatch_id)
          );

CREATE TABLE dispatch_ownership (
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            object_key TEXT NOT NULL CHECK (length(object_key) BETWEEN 1 AND 500),
            access_mode TEXT NOT NULL CHECK (access_mode IN ('read', 'write')),
            phase TEXT NOT NULL,
            PRIMARY KEY (dispatch_id, object_key, phase)
          );

CREATE TABLE dispatch_relations (
            dispatch_id TEXT PRIMARY KEY REFERENCES dispatches(id) ON DELETE CASCADE,
            parent_dispatch_id TEXT REFERENCES dispatches(id),
            logical_unit_key TEXT,
            retry_of_dispatch_id TEXT REFERENCES dispatches(id),
            CHECK (dispatch_id <> parent_dispatch_id),
            CHECK (dispatch_id <> retry_of_dispatch_id)
          );

CREATE TABLE "dispatches" (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('worker', 'verifier')),
            model TEXT NOT NULL CHECK (model IN (
              'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'
            )),
            effort TEXT NOT NULL CHECK (
              (model = 'gpt-5.6-luna' AND effort IN ('low', 'medium'))
              OR (model = 'gpt-5.6-terra' AND effort IN ('medium', 'high'))
              OR (model = 'gpt-5.6-sol' AND effort IN ('high', 'xhigh', 'max'))
              OR (model = 'gpt-6-astra' AND effort IN ('medium', 'high', 'xhigh', 'max'))
            ),
            thread_id TEXT,
            client_thread_id TEXT,
            workspace_path TEXT,
            status TEXT NOT NULL CHECK (status IN (
              'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
            )),
            verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            needs_attention INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
            attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
            evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (thread_id IS NOT NULL OR client_thread_id IS NOT NULL)
          );

CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
          evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
          created_at TEXT NOT NULL
        );

CREATE TABLE evidence_refs (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            evidence_level TEXT NOT NULL CHECK (evidence_level IN (
              'static', 'test', 'runtime', 'gui', 'external', 'publish'
            )),
            verification_status TEXT NOT NULL CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            producer_dispatch_id TEXT REFERENCES dispatches(id),
            verifier_dispatch_id TEXT REFERENCES dispatches(id),
            reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 1000),
            content_hash TEXT,
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
            created_at TEXT NOT NULL
          );

CREATE TABLE outcomes (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            attempt INTEGER NOT NULL CHECK (attempt >= 0),
            status TEXT NOT NULL CHECK (status IN (
              'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
            )),
            verification_status TEXT NOT NULL CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 600),
            environment_fingerprint TEXT NOT NULL,
            evidence_ref TEXT,
            created_at TEXT NOT NULL, evidence_ref_id TEXT REFERENCES evidence_refs(id),
            UNIQUE (dispatch_id, attempt)
          );

CREATE TABLE request_sessions (
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL,
            relation TEXT NOT NULL CHECK (relation IN ('origin', 'resume')),
            attached_at TEXT NOT NULL,
            PRIMARY KEY (request_id, session_id)
          );

CREATE TABLE requests (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 500),
          project_id TEXT,
          workspace_path TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'planning', 'running', 'verifying', 'waiting_user', 'done', 'failed', 'cancelled'
          )),
          progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
          progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
            'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
          )),
          needs_user INTEGER NOT NULL DEFAULT 0 CHECK (needs_user IN (0, 1)),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
          evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , root_session_id TEXT, lineage_status TEXT NOT NULL DEFAULT 'legacy_unknown'
            CHECK (lineage_status IN ('known', 'legacy_unknown')));

CREATE TABLE route_decisions (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            input_fingerprint TEXT NOT NULL,
            target_project_id TEXT,
            rule_matches_json TEXT NOT NULL,
            rule_outcome TEXT NOT NULL CHECK (rule_outcome IN ('selected', 'blocked', 'conflict')),
            skill_matches_json TEXT NOT NULL,
            tool_matches_json TEXT NOT NULL,
            candidate_refs_json TEXT NOT NULL,
            eligible_exposure INTEGER NOT NULL DEFAULT 0 CHECK (eligible_exposure IN (0, 1)),
            actual_hit INTEGER NOT NULL DEFAULT 0 CHECK (actual_hit IN (0, 1)),
            reason_code TEXT NOT NULL,
            reason_summary TEXT NOT NULL CHECK (length(reason_summary) BETWEEN 1 AND 400),
            environment_fingerprint TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

CREATE INDEX candidate_refs_request_updated ON candidate_refs(request_id, updated_at DESC);

CREATE INDEX dispatch_ownership_object ON dispatch_ownership(object_key, phase, access_mode);

CREATE UNIQUE INDEX dispatches_client_thread_id_unique
            ON dispatches(client_thread_id) WHERE client_thread_id IS NOT NULL;

CREATE INDEX dispatches_request_updated ON dispatches(request_id, updated_at DESC);

CREATE UNIQUE INDEX dispatches_thread_id_unique
            ON dispatches(thread_id) WHERE thread_id IS NOT NULL;

CREATE INDEX events_request_created ON events(request_id, created_at DESC, id DESC);

CREATE INDEX evidence_refs_request_created ON evidence_refs(request_id, created_at DESC);

CREATE UNIQUE INDEX request_sessions_origin_unique
            ON request_sessions(request_id) WHERE relation = 'origin';

CREATE INDEX route_decisions_request_created ON route_decisions(request_id, created_at DESC);

CREATE TRIGGER candidate_refs_routing_insert_gate
          BEFORE INSERT ON candidate_refs
          WHEN NEW.routing_eligible = 1 AND NOT (
            NEW.source_status = 'connected'
            AND NEW.candidate_status = 'accepted'
            AND NEW.validation_status = 'PASS'
            AND NEW.qualification_status = 'eligible'
            AND NEW.canonical_ref IS NOT NULL AND length(NEW.canonical_ref) > 0
            AND NEW.local_record_status = 'recorded'
            AND NEW.enable_status = 'enabled'
            AND NEW.value_gate_decision = 'GO'
            AND NEW.capacity_status = 'available'
            AND NEW.budget_locked = 1
            AND NEW.sample_plan_locked = 1
            AND NEW.pilot_cluster_locked = 1
            AND NEW.rollback_sla_locked = 1
            AND NEW.governance_endpoint_locked = 1
            AND NEW.orchestrator_route_blocked_at IS NULL
          )
          BEGIN
            SELECT RAISE(ABORT, 'candidate routing gates are incomplete');
          END;

CREATE TRIGGER candidate_refs_routing_update_gate
          BEFORE UPDATE OF routing_eligible, source_status, candidate_status, validation_status,
            qualification_status, canonical_ref, local_record_status, enable_status,
            value_gate_decision, capacity_status, budget_locked, sample_plan_locked,
            pilot_cluster_locked, rollback_sla_locked, governance_endpoint_locked,
            orchestrator_route_blocked_at ON candidate_refs
          WHEN NEW.routing_eligible = 1 AND NOT (
            NEW.source_status = 'connected'
            AND NEW.candidate_status = 'accepted'
            AND NEW.validation_status = 'PASS'
            AND NEW.qualification_status = 'eligible'
            AND NEW.canonical_ref IS NOT NULL AND length(NEW.canonical_ref) > 0
            AND NEW.local_record_status = 'recorded'
            AND NEW.enable_status = 'enabled'
            AND NEW.value_gate_decision = 'GO'
            AND NEW.capacity_status = 'available'
            AND NEW.budget_locked = 1
            AND NEW.sample_plan_locked = 1
            AND NEW.pilot_cluster_locked = 1
            AND NEW.rollback_sla_locked = 1
            AND NEW.governance_endpoint_locked = 1
            AND NEW.orchestrator_route_blocked_at IS NULL
          )
          BEGIN
            SELECT RAISE(ABORT, 'candidate routing gates are incomplete');
          END;

CREATE TRIGGER dispatch_dependencies_running_insert_gate
          BEFORE INSERT ON dispatch_dependencies
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running'
            AND (SELECT status FROM dispatches WHERE id = NEW.depends_on_dispatch_id) <> 'done'
          BEGIN
            SELECT RAISE(ABORT, 'running dispatch cannot depend on unfinished work');
          END;

CREATE TRIGGER dispatch_ownership_running_insert_gate
          BEFORE INSERT ON dispatch_ownership
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS existing
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE existing.object_key = NEW.object_key
              AND existing.phase = NEW.phase
              AND existing.dispatch_id <> NEW.dispatch_id
              AND active_dispatch.status = 'running'
              AND (NEW.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

CREATE TRIGGER dispatch_ownership_running_update_gate
          BEFORE UPDATE OF object_key, access_mode, phase, dispatch_id ON dispatch_ownership
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS existing
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE existing.object_key = NEW.object_key
              AND existing.phase = NEW.phase
              AND existing.dispatch_id <> NEW.dispatch_id
              AND active_dispatch.status = 'running'
              AND (NEW.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

CREATE TRIGGER dispatches_current_model_insert
          BEFORE INSERT ON dispatches
          WHEN NEW.model = 'gpt-5.6-luna'
          BEGIN
            SELECT RAISE(ABORT, 'legacy model cannot be used for a new dispatch');
          END;

CREATE TRIGGER dispatches_identity_insert
          BEFORE INSERT ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

CREATE TRIGGER dispatches_identity_update
          BEFORE UPDATE OF thread_id, client_thread_id ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

CREATE TRIGGER dispatches_legacy_model_update
          BEFORE UPDATE OF model, effort ON dispatches
          WHEN (OLD.model = 'gpt-5.6-luna' AND (
              NEW.model <> OLD.model OR NEW.effort <> OLD.effort
            )) OR (OLD.model <> 'gpt-5.6-luna' AND NEW.model = 'gpt-5.6-luna')
          BEGIN
            SELECT RAISE(ABORT, 'legacy dispatch model and effort are immutable');
          END;

CREATE TRIGGER dispatches_running_dependency_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_dependencies AS dependency
            JOIN dispatches AS required_dispatch ON required_dispatch.id = dependency.depends_on_dispatch_id
            WHERE dependency.dispatch_id = NEW.id AND required_dispatch.status <> 'done'
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch dependencies are not done');
          END;

CREATE TRIGGER dispatches_running_ownership_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS requested
            JOIN dispatch_ownership AS existing
              ON existing.object_key = requested.object_key
             AND existing.phase = requested.phase
             AND existing.dispatch_id <> requested.dispatch_id
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE requested.dispatch_id = NEW.id
              AND active_dispatch.status = 'running'
              AND (requested.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

CREATE TRIGGER evidence_refs_immutable_delete BEFORE DELETE ON evidence_refs
          BEGIN SELECT RAISE(ABORT, 'evidence references are immutable'); END;

CREATE TRIGGER evidence_refs_immutable_update BEFORE UPDATE ON evidence_refs
          BEGIN SELECT RAISE(ABORT, 'evidence references are immutable'); END;

CREATE TRIGGER evidence_refs_pass_gate
          BEFORE INSERT ON evidence_refs
          WHEN NEW.verification_status = 'PASS' AND NOT (
            NEW.dispatch_id = NEW.verifier_dispatch_id
            AND NEW.producer_dispatch_id IS NOT NULL
            AND NEW.verifier_dispatch_id IS NOT NULL
            AND NEW.verifier_dispatch_id <> NEW.producer_dispatch_id
            AND (SELECT role FROM dispatches WHERE id = NEW.verifier_dispatch_id) = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS evidence must be recorded by an independent verifier');
          END;

CREATE TRIGGER outcomes_immutable_delete BEFORE DELETE ON outcomes
          BEGIN SELECT RAISE(ABORT, 'outcomes are immutable'); END;

CREATE TRIGGER outcomes_immutable_update BEFORE UPDATE ON outcomes
          BEGIN SELECT RAISE(ABORT, 'outcomes are immutable'); END;

CREATE TRIGGER outcomes_pass_evidence_gate
          BEFORE INSERT ON outcomes
          WHEN NEW.verification_status = 'PASS' AND NOT EXISTS (
            SELECT 1
            FROM evidence_refs AS evidence
            JOIN dispatches AS verifier ON verifier.id = evidence.verifier_dispatch_id
            WHERE evidence.id = NEW.evidence_ref_id
              AND evidence.request_id = NEW.request_id
              AND evidence.verification_status = 'PASS'
              AND evidence.producer_dispatch_id = NEW.dispatch_id
              AND evidence.verifier_dispatch_id IS NOT NULL
              AND evidence.verifier_dispatch_id <> evidence.producer_dispatch_id
              AND verifier.role = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS outcome requires immutable independent evidence');
          END;

CREATE TRIGGER requests_lineage_insert_gate
          BEFORE INSERT ON requests
          WHEN NEW.root_session_id IS NULL OR NEW.lineage_status <> 'known'
          BEGIN
            SELECT RAISE(ABORT, 'new requests require an explicit root session');
          END;

CREATE TRIGGER requests_pass_insert_gate
          BEFORE INSERT ON requests
          WHEN NEW.verification_status = 'PASS'
          BEGIN
            SELECT RAISE(ABORT, 'new requests cannot start with PASS verification');
          END;

CREATE TRIGGER requests_pass_update_gate
          BEFORE UPDATE OF verification_status ON requests
          WHEN NEW.verification_status = 'PASS' AND NOT EXISTS (
            SELECT 1
            FROM evidence_refs AS evidence
            JOIN dispatches AS verifier ON verifier.id = evidence.verifier_dispatch_id
            WHERE evidence.request_id = NEW.id
              AND evidence.verification_status = 'PASS'
              AND evidence.verifier_dispatch_id IS NOT NULL
              AND evidence.verifier_dispatch_id <> evidence.producer_dispatch_id
              AND verifier.role = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS request requires immutable independent evidence');
          END;
PRAGMA user_version = 6;
