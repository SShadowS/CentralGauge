codeunit 70239 "CGR Day Closing Run"
{
    TableNo = "CGR Rental Branch";

    var
        DayToClose: Date;

    procedure SetDayToClose(NewDayToClose: Date)
    begin
        DayToClose := NewDayToClose;
    end;

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        CashCount: Record "CGR Cash Count";
        ClosingEntry: Record "CGR Day Closing Entry";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        ExpectedAmount: Decimal;
    begin
        Contract.SetRange("Branch Code", Rec.Code);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', DayToClose);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;

        foreach ContractNo in ContractNos do begin
            Contract.Get(ContractNo);
            Codeunit.Run(Codeunit::"CGR Rental-Post", Contract);
            LedgerEntry.SetRange("Contract No.", ContractNo);
            if LedgerEntry.FindSet() then
                repeat
                    ExpectedAmount += LedgerEntry.Amount;
                until LedgerEntry.Next() = 0;
        end;

        CashCount.Init();
        CashCount."Branch Code" := Rec.Code;
        CashCount."Closing Date" := DayToClose;
        CashCount."Expected Amount" := ExpectedAmount;
        CashCount.Insert(true);

        ClosingEntry.Init();
        ClosingEntry."Branch Code" := Rec.Code;
        ClosingEntry."Closing Date" := DayToClose;
        ClosingEntry."Contracts Posted" := ContractNos.Count();
        ClosingEntry."Closed At" := CurrentDateTime();
        ClosingEntry.Insert(true);

        OnAfterDayClosed(Rec, DayToClose);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDayClosed(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)
    begin
    end;
}
