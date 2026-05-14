namespace CentralGauge.TestHarness;

using System.Integration;

/// <summary>
/// Registers the headless test runner codeunit as a published web service
/// so it is callable over SOAP immediately after install.
/// </summary>
codeunit 50501 "CG WS Harness Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        TenantWebService: Record "Tenant Web Service";
    begin
        if TenantWebService.Get(TenantWebService."Object Type"::Codeunit, 'CGTestRunner') then
            exit;

        TenantWebService.Init();
        TenantWebService."Object Type" := TenantWebService."Object Type"::Codeunit;
        TenantWebService."Object ID" := Codeunit::"CG WS Test Runner";
        TenantWebService."Service Name" := 'CGTestRunner';
        TenantWebService.Published := true;
        TenantWebService.Insert(true);
    end;
}
