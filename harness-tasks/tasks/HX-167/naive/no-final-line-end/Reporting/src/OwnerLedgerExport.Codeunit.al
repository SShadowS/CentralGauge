codeunit 70554 "CGR Owner Ledger Export"
{
    procedure WriteOwnerLedgerFile(VehicleNo: Code[20]; FromDate: Date; ToDate: Date; var OwnerFile: Record "CGR Owner Ledger File")
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
        FileStream: OutStream;
    begin
        Clear(OwnerFile.Content);
        OwnerFile.Content.CreateOutStream(FileStream, TextEncoding::UTF8);
        FileStream.WriteText('Contract;Customer;Posting Date;Amount');
        LedgerEntry.SetCurrentKey("Vehicle No.", "Posting Date");
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.SetRange("Posting Date", FromDate, ToDate);
        if LedgerEntry.FindSet() then
            repeat
                FileStream.WriteText();
                FileStream.WriteText(OwnerLedgerLine(LedgerEntry));
            until LedgerEntry.Next() = 0;
        OwnerFile.Modify();
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
