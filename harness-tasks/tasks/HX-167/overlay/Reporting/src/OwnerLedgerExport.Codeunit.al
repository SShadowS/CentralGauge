codeunit 70554 "CGR Owner Ledger Export"
{
    procedure BuildOwnerLedgerText(VehicleNo: Code[20]; FromDate: Date; ToDate: Date): Text
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
        FileText: Text;
        CrLf: Text[2];
    begin
        CrLf[1] := 13;
        CrLf[2] := 10;
        FileText := 'Contract;Customer;Posting Date;Amount' + CrLf;
        LedgerEntry.SetCurrentKey("Vehicle No.", "Posting Date");
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.SetRange("Posting Date", FromDate, ToDate);
        if LedgerEntry.FindSet() then
            repeat
                FileText += OwnerLedgerLine(LedgerEntry) + CrLf;
            until LedgerEntry.Next() = 0;
        exit(FileText);
    end;

    local procedure OwnerLedgerLine(LedgerEntry: Record "CGR Rental Ledger Entry"): Text
    var
        Contract: Record "CGR Rental Contract";
        CustomerName: Text[100];
    begin
        if Contract.Get(LedgerEntry."Contract No.") then
            CustomerName := Contract."Customer Name";
        exit(LedgerEntry."Contract No." + ';' + CustomerName + ';' + Format(LedgerEntry."Posting Date", 0, 9) + ';' + Format(LedgerEntry.Amount, 0, 9));
    end;
}
