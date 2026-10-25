---
bc-version: [all]
domain: ui
keywords: [accessbypermission, rolecenter, role-center, pageextension, client-expression, permission, al0569, al0573, al0378]
technologies: [al]
countries: [w1]
application-area: [all]
---

# Gate Role Center content by permission with AccessByPermission

## Description

A page of type `RoleCenter` cannot have triggers (AL0378, error) or procedures (AL0569, warning that will become an error), and the AL compiler applies both rules to a pageextension whose target is a Role Center. That removes the usual way to show a control conditionally: compute a global Boolean in `OnOpenPage` and bind `Visible` to it. An easy-looking remediation of AL0378 is to delete the trigger and bind `Visible` or `Enabled` directly to a local procedure such as `CanSeeMyCustomers()`. That still builds, but with two future errors: AL0573 for the procedure call in a client expression and AL0569 for the procedure itself. Neither message names the alternative.

When the condition is "the user has permission to this object", the declarative alternative is the `AccessByPermission` property on the part, action, or field. It takes `TableData <table> = R|I|M|D` (any combination; having any one of the listed permissions is enough) or `X` for `Table`, `Page`, `Report`, `Codeunit`, `XmlPort`, or `Query`. Its applies-to list covers page fields, parts, system parts, chart parts, actions, and whole pages and reports; it does not include groups or cue groups. The element is removed for users without the permission, not disabled. That per-user removal requires the UI Elements Removal setting `LicenseFileAndUserPermissions`; under `LicenseFile` removal follows the license, not the user's permission sets.

## Best Practice

Set `AccessByPermission` on the Role Center part, action, or field that should appear only for users with the permission, naming the table or object that the part actually depends on. The base application does this on its own Role Centers, for example `AccessByPermission = TableData "Activities Cue" = I` on the activities part of the Business Manager Role Center and `TableData "Report Inbox" = IMD` on the Report Inbox part (`Control96`) of the same Role Center and of the Accountant Role Center.

Two limits apply. The property takes effect only when the server's UI Elements Removal setting is `LicenseFile` or `LicenseFileAndUserPermissions`. It is UI removal, not a security boundary: the part's source data must still be protected by real permissions. When the condition is not a permission check, such as a setup value or a feature flag, `AccessByPermission` is the wrong tool. Put the condition inside the part page, which is a normal `CardPart` or `ListPart` that can have triggers. The part cannot remove itself from the Role Center, but it can hide or empty its own controls. See sample: [`rolecenter-permission-gating-must-use-accessbypermission.good.al`](rolecenter-permission-gating-must-use-accessbypermission.good.al).

## Anti Pattern

A `RoleCenter` page, or a pageextension whose target is a Role Center, binds `Visible` or `Enabled` on a part, action, or field to a procedure call whose body checks `ReadPermission`, `WritePermission`, or a similar permission test, and declares that procedure. The compiler reports AL0573 and AL0569 as warnings, and both will become errors. Reviewer signal: a pageextension declares a procedure and AL0569 appears in its build output. The extended page's name is not reliable evidence of its type, so confirm the target is a Role Center from its `PageType` or from that diagnostic. Do not flag setup- or feature-based gating implemented inside the part page itself; that is the correct location for non-permission conditions. See sample: [`rolecenter-permission-gating-must-use-accessbypermission.bad.al`](rolecenter-permission-gating-must-use-accessbypermission.bad.al).

## References

- [AccessByPermission property](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/properties/devenv-accessbypermission-property): applies-to list, permission values, any-one-of semantics, and the UI Elements Removal requirement ([Hide UI elements](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/hide-ui-elements)).
- [Compiler error AL0378](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al378), [compiler warning AL0569](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al569), and [compiler warning AL0573](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al573). AL compiler 30.0 reports all three on a pageextension of a Role Center, as it does on the Role Center page itself.
- Base application usage: [BusinessManagerRoleCenter.Page.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al) (`Control96`, lines 124-127) and [AccountantRoleCenter.Page.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Finance/RoleCenters/AccountantRoleCenter.Page.al). No Role Center page in BCApps declares a trigger or procedure.
