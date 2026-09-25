codeunit 70300 "CGR Lease Mgt"
{
    var
        MonthsErr: Label 'Lease %1 must run for at least one month.', Comment = '%1 = lease number';
        InvoicedErr: Label 'Lease %1 has invoiced schedule lines and cannot be rescheduled.', Comment = '%1 = lease number';

    procedure MonthlyRate(BaseRate: Decimal; Months: Integer): Decimal
    var
        LeaseMath: Codeunit "CGR Lease Math";
    begin
        exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));
    end;

    procedure CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]
    var
        Contract: Record "CGR Lease Contract";
        Setup: Record "CGR Setup";
    begin
        Contract.Init();
        Contract."No." := Setup.NextLeaseNo();
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := CustomerName;
        Contract."Start Date" := StartDate;
        Contract.Months := Months;
        Contract."Base Rate" := BaseRate;
        Contract.Insert(true);
        exit(Contract."No.");
    end;

    procedure CreateSchedule(ContractNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMath: Codeunit "CGR Lease Math";
        Amounts: List of [Decimal];
        DueDate: Date;
        i: Integer;
    begin
        Contract.Get(ContractNo);
        if Contract.Months <= 0 then
            Error(MonthsErr, ContractNo);
        Line.SetRange("Contract No.", ContractNo);
        Line.SetRange(Invoiced, true);
        if not Line.IsEmpty() then
            Error(InvoicedErr, ContractNo);
        Line.SetRange(Invoiced);
        Line.DeleteAll(true);
        LeaseMath.SplitInstallments(LeaseMath.LeaseTotal(Contract."Base Rate", Contract.Months), Contract.Months, Amounts);
        DueDate := Contract."Start Date";
        for i := 1 to Contract.Months do begin
            Line.Init();
            Line."Contract No." := ContractNo;
            Line."Line No." := i * 10000;
            Line."Due Date" := DueDate;
            Line.Amount := Amounts.Get(i);
            Line.Insert(true);
            DueDate := CalcDate('<+1M>', DueDate);
        end;
    end;

    procedure InvoiceLine(ContractNo: Code[20]; LineNo: Integer)
    var
        Line: Record "CGR Lease Schedule Line";
    begin
        Line.Get(ContractNo, LineNo);
        Line.Invoiced := true;
        Line.Modify(true);
    end;
}
