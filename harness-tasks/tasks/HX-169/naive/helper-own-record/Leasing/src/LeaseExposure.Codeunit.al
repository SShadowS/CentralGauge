codeunit 70387 "CGR Lease Exposure"
{
    procedure OpenLeaseBalance(ContractNo: Code[20]): Decimal
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        OpenBalance: Decimal;
    begin
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        if ScheduleLine.FindSet() then
            repeat
                OpenBalance += ScheduleLine.Amount;
            until ScheduleLine.Next() = 0;
        OnAfterOpenLeaseBalance(ContractNo, OpenBalance);
        exit(OpenBalance);
    end;

    procedure CompanyExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Contract: Record "CGR Lease Contract";
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        AddExposureLine(ExposureLine, 1, CopyStr(CompanyName(), 1, MaxStrLen(ExposureLine."Company Name")), Contract);
    end;

    procedure GroupExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Company: Record Company;
        Contract: Record "CGR Lease Contract";
        LineNo: Integer;
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        if Company.FindSet() then
            repeat
                LineNo += 1;
                Contract.ChangeCompany(Company.Name);
                AddExposureLine(ExposureLine, LineNo, Company.Name, Contract);
            until Company.Next() = 0;
    end;

    local procedure AddExposureLine(var ExposureLine: Record "CGR Lease Exposure Line" temporary; LineNo: Integer; ExposureCompany: Text[30]; var Contract: Record "CGR Lease Contract")
    var
        OpenBalance: Decimal;
    begin
        ExposureLine.Init();
        ExposureLine."Line No." := LineNo;
        ExposureLine."Company Name" := ExposureCompany;
        if Contract.FindSet() then
            repeat
                OpenBalance := OpenLeaseBalance(Contract."No.");
                if OpenBalance <> 0 then begin
                    ExposureLine."Open Leases" += 1;
                    ExposureLine."Open Balance" += OpenBalance;
                end;
            until Contract.Next() = 0;
        ExposureLine.Insert();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterOpenLeaseBalance(ContractNo: Code[20]; OpenBalance: Decimal)
    begin
    end;
}
