codeunit 70760 "CG X116 Remittance Composer"
{
    var
        Entries: List of [Text];
        EntryTooLongErr: Label 'Invoice %1 needs %2 characters, more than the 140 character limit for a remittance line entry.', Comment = '%1 = invoice number, %2 = length of the composed entry';
        MoreSuffixLbl: Label 'and %1 more', Locked = true, Comment = '%1 = number of omitted invoices';

    procedure AddInvoice(InvoiceNo: Text; Amount: Decimal)
    var
        Entry: Text;
    begin
        Entry := InvoiceNo + ' ' + Format(Amount);
        if StrLen(Entry) > 140 then
            Error(EntryTooLongErr, InvoiceNo, StrLen(Entry));
        Entries.Add(Entry);
    end;

    procedure GetRemittanceText(): Text
    var
        Kept: Integer;
    begin
        if StrLen(JoinFirst(Entries.Count())) <= 140 then
            exit(JoinFirst(Entries.Count()));

        Kept := Entries.Count();
        while (Kept > 0) and (StrLen(JoinFirst(Kept)) > 140) do
            Kept -= 1;
        exit(OverflowText(Kept));
    end;

    local procedure OverflowText(Kept: Integer): Text
    begin
        if Kept = 0 then
            exit(StrSubstNo(MoreSuffixLbl, Entries.Count()));
        exit(JoinFirst(Kept) + ', ' + StrSubstNo(MoreSuffixLbl, Entries.Count() - Kept));
    end;

    local procedure JoinFirst(EntryCount: Integer): Text
    var
        Index: Integer;
        Result: Text;
    begin
        for Index := 1 to EntryCount do begin
            if Index > 1 then
                Result += ', ';
            Result += Entries.Get(Index);
        end;
        exit(Result);
    end;
}
