# Claude Code Prompt: Build HACS Integration for OPNsense Captive Portal

Use this prompt in a new empty repository to have Claude Code build the Home Assistant custom integration.

---

## Prompt

Build a Home Assistant custom integration (HACS-compatible) called `opensense_captive_portal` that connects to an OPNsense Captive Portal server's Home Assistant API.

### API Details

The captive portal exposes these JSON endpoints, all authenticated with `Authorization: Bearer <token>`:

**GET `/api/ha/status`** — returns:
```json
{
  "persons": { "total": 5, "home": 3, "away": 2 },
  "devices": { "total": 12, "approved": 10, "pending": 2, "online": 6, "offline": 6 },
  "login_attempts": { "locked_accounts": 1, "total_tracked": 4 },
  "unknown_macs": 3,
  "errors": 0
}
```

**GET `/api/ha/persons`** — returns:
```json
[
  {
    "id": 1,
    "name": "Alice",
    "phone": "555-0001",
    "home": true,
    "device_count": 2,
    "devices": [
      {
        "id": 1,
        "mac_address": "AA:BB:CC:DD:EE:01",
        "device_type": "phone",
        "is_presence_tracker": 1,
        "approved": 1,
        "last_seen": "2025-01-15T10:30:00.000Z",
        "online": true
      }
    ]
  }
]
```

**GET `/api/ha/persons/:id`** — returns single person object (same shape as array element above).

**GET `/api/ha/attempts`** — returns:
```json
[
  {
    "phone": "555-0001",
    "attempts": 3,
    "max_attempts": 3,
    "locked": true,
    "needs_refill": true,
    "last_attempt": "2025-01-15T10:30:00"
  }
]
```

### Integration Requirements

1. **Config Flow** — Setup via UI (Settings > Integrations > Add). User provides:
   - `host`: URL of the captive portal (e.g. `http://192.168.1.50:3000`)
   - `token`: The HA API token (Bearer token)
   - `scan_interval`: Polling interval in seconds (default 30)

2. **Sensors** (from `/api/ha/status`):
   - `sensor.captive_portal_persons_total` — Total registered persons
   - `sensor.captive_portal_persons_home` — Persons currently home
   - `sensor.captive_portal_persons_away` — Persons currently away
   - `sensor.captive_portal_devices_total` — Total devices
   - `sensor.captive_portal_devices_approved` — Approved devices
   - `sensor.captive_portal_devices_pending` — Pending approval
   - `sensor.captive_portal_devices_online` — Currently online devices
   - `sensor.captive_portal_locked_accounts` — Accounts that need attempt refills
   - `sensor.captive_portal_unknown_macs` — Unknown MAC addresses on network
   - `sensor.captive_portal_errors` — Error count

3. **Device Trackers** (from `/api/ha/persons`):
   - One `device_tracker` entity per person: `device_tracker.captive_portal_<slugified_name>`
   - State: `home` if person's `home` field is `true`, `away` otherwise
   - Attributes: `phone`, `device_count`, `devices` (list of MAC addresses), `tracker_mac` (the presence tracker device's MAC)
   - Use `SOURCE_TYPE_ROUTER` as source type
   - Each person should appear as a device in the HA device registry grouped under the integration

4. **Binary Sensors** (from `/api/ha/attempts`):
   - `binary_sensor.captive_portal_locked_accounts` — ON if any accounts are locked
   - Attribute: list of locked phone numbers with their attempt counts

5. **Polling & Coordinator**:
   - Use `DataUpdateCoordinator` for centralized polling
   - Single coordinator that fetches `/api/ha/status`, `/api/ha/persons`, and `/api/ha/attempts`
   - Default 30-second scan interval, configurable in setup
   - Handle connection errors gracefully with `UpdateFailed`

6. **HACS Compatibility**:
   - Include `hacs.json` manifest with proper fields
   - Include `manifest.json` with `iot_class: "local_polling"`, `version`, `documentation` URL
   - Follow HA directory structure: `custom_components/opensense_captive_portal/`
   - Include `__init__.py`, `config_flow.py`, `sensor.py`, `device_tracker.py`, `binary_sensor.py`, `coordinator.py`, `const.py`
   - Include `strings.json` and `translations/en.json` for config flow UI strings

7. **Repository Structure**:
   ```
   custom_components/
     opensense_captive_portal/
       __init__.py
       config_flow.py
       const.py
       coordinator.py
       sensor.py
       device_tracker.py
       binary_sensor.py
       manifest.json
       strings.json
       translations/
         en.json
   hacs.json
   README.md
   ```

8. **Error Handling**:
   - Validate connection during config flow (test call to `/api/ha/status`)
   - Show clear error if host is unreachable or token is invalid
   - Use `ConfigEntryNotReady` if portal is down at startup
   - Log warnings on transient failures, don't crash

9. **README** should include:
   - What it does
   - Prerequisites (running captive portal with HA_API_TOKEN set)
   - HACS installation steps
   - Manual installation steps
   - Configuration via UI
   - List of all entities created
   - Example automations (notify when someone arrives home, alert on locked accounts, alert on pending devices)

### Code Style
- Use `async/aiohttp` for all HTTP calls (never `requests`)
- Type hints throughout
- Follow Home Assistant coding standards
- Use `homeassistant.helpers.entity_platform` patterns
- Entities should have proper `unique_id`, `device_info`, and `entity_registry_enabled_default`

### Example Automations to Include in README

```yaml
# Notify when someone comes home
automation:
  - alias: "Person arrived home"
    trigger:
      - platform: state
        entity_id: device_tracker.captive_portal_alice
        to: "home"
    action:
      - service: notify.mobile_app
        data:
          message: "{{ trigger.to_state.name }} just arrived home"

# Alert on locked accounts needing refill
automation:
  - alias: "Locked account alert"
    trigger:
      - platform: numeric_state
        entity_id: sensor.captive_portal_locked_accounts
        above: 0
    action:
      - service: notify.mobile_app
        data:
          message: "{{ states('sensor.captive_portal_locked_accounts') }} captive portal accounts are locked"

# Alert on pending device approvals
automation:
  - alias: "Pending device approval"
    trigger:
      - platform: numeric_state
        entity_id: sensor.captive_portal_devices_pending
        above: 0
    action:
      - service: notify.mobile_app
        data:
          message: "{{ states('sensor.captive_portal_devices_pending') }} devices waiting for approval"
```
