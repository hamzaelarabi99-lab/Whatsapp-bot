# WhatsApp Coupe & Point Bot — Pairing v3

## Railway
1. Replace `index.js`, `package.json`, and `database.json`.
2. Redeploy.
3. Open Deploy -> Logs.
4. Wait for:
   `🔐 كود الربط مع واتساب: XXXXXXXX`
5. WhatsApp -> الأجهزة المرتبطة -> ربط جهاز -> الربط برقم الهاتف.
6. Enter the NEW code immediately.

## Important
- Pairing code only; no QR is used.
- PHONE_NUMBER can be set as a Railway variable using digits only, e.g. `212710530141`.
- On 401/loggedOut, the bot removes the old auth folder and makes one clean retry.
- Logs now show the exact disconnect status code.

## Commands
!coupe
!point
!top
!setcoupe @person
!setpoint @person amount

`setcoupe` and `setpoint` require group-admin privileges.

## Data
Cups and points are stored in `database.json`.
