codeunit 70317 "CGR Lease Extension"
{
    var
        ExtraMonthsErr: Label 'Lease %1 can only be extended by at least one month.', Comment = '%1 = lease number';

    procedure ExtendLease(ContractNo: Code[20]; ExtraMonths: Integer)
    var
        Contract: Record "CGR Lease Contract";
        LastLine: Record "CGR Lease Schedule Line";
        NewLine: Record "CGR Lease Schedule Line";
        LeaseMath: Codeunit "CGR Lease Math";
        NewMonths: Integer;
        LineNo: Integer;
        i: Integer;
    begin
        if ExtraMonths <= 0 then
            Error(ExtraMonthsErr, ContractNo);
        Contract.Get(ContractNo);
        NewMonths := Contract.Months + ExtraMonths;
        LastLine.SetRange("Contract No.", ContractNo);
        LastLine.FindLast();
        LineNo := LastLine."Line No.";
        for i := 1 to ExtraMonths do begin
            LineNo += 10000;
            NewLine.Init();
            NewLine."Contract No." := ContractNo;
            NewLine."Line No." := LineNo;
            NewLine."Due Date" := CalcDate(StrSubstNo('<+%1M>', Contract.Months + i - 1), Contract."Start Date");
            NewLine.Amount := Round(Contract."Base Rate" * LeaseMath.RateFactor(NewMonths), 0.01);
            NewLine.Insert(true);
        end;
        Contract.Months := NewMonths;
        Contract.Modify(true);
    end;
}
