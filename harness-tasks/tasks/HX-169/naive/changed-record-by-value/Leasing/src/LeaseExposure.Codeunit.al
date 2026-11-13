codeunit 70387 "CGR Lease Exposure"
{
    procedure CompanyExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        AddExposureLine(ExposureLine, 1, CopyStr(CompanyName(), 1, MaxStrLen(ExposureLine."Company Name")), Contract, ScheduleLine);
    end;

    procedure GroupExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Company: Record Company;
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LineNo: Integer;
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        if Company.FindSet() then
            repeat
                LineNo += 1;
                Contract.ChangeCompany(Company.Name);
                ScheduleLine.ChangeCompany(Company.Name);
                AddExposureLine(ExposureLine, LineNo, Company.Name, Contract, ScheduleLine);
            until Company.Next() = 0;
    end;

    local procedure AddExposureLine(var ExposureLine: Record "CGR Lease Exposure Line" temporary; LineNo: Integer; ExposureCompany: Text[30]; var Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line")
    var
        LeaseBalance: Codeunit "CGR Lease Balance";
        OpenBalance: Decimal;
    begin
        ExposureLine.Init();
        ExposureLine."Line No." := LineNo;
        ExposureLine."Company Name" := ExposureCompany;
        if Contract.FindSet() then
            repeat
                OpenBalance := LeaseBalance.OpenLeaseBalanceFrom(ScheduleLine, Contract."No.");
                if OpenBalance <> 0 then begin
                    ExposureLine."Open Leases" += 1;
                    ExposureLine."Open Balance" += OpenBalance;
                end;
            until Contract.Next() = 0;
        ExposureLine.Insert();
    end;
}
