#!/usr/bin/env python3
"""Patches ios/App/App.xcodeproj/project.pbxproj to configure manual signing."""
import os, re

pbxproj = 'ios/App/App.xcodeproj/project.pbxproj'
team_id = os.environ.get('TEAM_ID', '')
pp_name = os.environ.get('PP_NAME', '')

if not team_id or not pp_name:
    print('ERROR: TEAM_ID and PP_NAME environment variables must be set')
    exit(1)

with open(pbxproj, 'r') as f:
    content = f.read()

content = content.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')

signing_addition = (
    'CODE_SIGN_STYLE = Manual;\n'
    '\t\t\t\tDEVELOPMENT_TEAM = ' + team_id + ';\n'
    '\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "' + pp_name + '";'
)
content = content.replace('CODE_SIGN_STYLE = Manual;', signing_addition)

with open(pbxproj, 'w') as f:
    f.write(content)

print('pbxproj patched successfully')
print('  Team ID:', team_id)
print('  Provisioning Profile:', pp_name)
