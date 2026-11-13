codeunit 70387 "CGR Lease Exposure"
{
    procedure CompanyExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Contract: Record "CGR Lease Contract";
        LeaseBalance: Codeunit "CGR Lease Balance";
        OpenBalance: Decimal;
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        ExposureLine.Init();
        ExposureLine."Line No." := 1;
        ExposureLine."Company Name" := CopyStr(CompanyName(), 1, MaxStrLen(ExposureLine."Company Name"));
        if Contract.FindSet() then
            repeat
                OpenBalance := LeaseBalance.OpenLeaseBalance(Contract."No.");
                if OpenBalance <> 0 then begin
                    ExposureLine."Open Leases" += 1;
                    ExposureLine."Open Balance" += OpenBalance;
                end;
            until Contract.Next() = 0;
        ExposureLine.Insert();
    end;

    procedure GroupExposure(var ExposureLine: Record "CGR Lease Exposure Line" temporary)
    var
        Company: Record Company;
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        OpenBalance: Decimal;
        LineNo: Integer;
    begin
        ExposureLine.Reset();
        ExposureLine.DeleteAll();
        if Company.FindSet() then
            repeat
                LineNo += 1;
                Contract.ChangeCompany(Company.Name);
                ScheduleLine.ChangeCompany(Company.Name);
                ExposureLine.Init();
                ExposureLine."Line No." := LineNo;
                ExposureLine."Company Name" := Company.Name;
                if Contract.FindSet() then
                    repeat
                        OpenBalance := 0;
                        ScheduleLine.SetRange("Contract No.", Contract."No.");
                        ScheduleLine.SetRange(Invoiced, false);
                        if ScheduleLine.FindSet() then
                            repeat
                                OpenBalance += ScheduleLine.Amount;
                            until ScheduleLine.Next() = 0;
                        if OpenBalance <> 0 then begin
                            ExposureLine."Open Leases" += 1;
                            ExposureLine."Open Balance" += OpenBalance;
                        end;
                    until Contract.Next() = 0;
                ExposureLine.Insert();
            until Company.Next() = 0;
    end;
}
