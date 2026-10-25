namespace CentralGauge.SqlMeasure;

using System.Integration;

/// <summary>
/// Q-06: registers the measuring runner as the web service CGSqlMeasure, the
/// same way the test harness registers CGTestRunner.
/// </summary>
codeunit 50562 "CG SQL Measure Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        TenantWebService: Record "Tenant Web Service";
    begin
        if TenantWebService.Get(TenantWebService."Object Type"::Codeunit, 'CGSqlMeasure') then
            exit;

        TenantWebService.Init();
        TenantWebService."Object Type" := TenantWebService."Object Type"::Codeunit;
        TenantWebService."Object ID" := Codeunit::"CG SQL Measure Runner";
        TenantWebService."Service Name" := 'CGSqlMeasure';
        TenantWebService.Published := true;
        TenantWebService.Insert(true);
    end;
}
