codeunit 69771 "CG X019 Normalizer"
{
    procedure Normalize(RefID: Guid)
    var
        Doc: Record "CG X019 Doc";
        OldAmount: Integer;
        NewNo: Code[20];
    begin
        Doc.SetRange("Ref ID", RefID);
        if not Doc.FindFirst() then
            exit;

        // The new primary key is derived from the row's OWN prior state, not
        // from anything the caller supplies -- callers cannot predict it up
        // front, so they cannot re-locate the row afterward by guessing a new
        // "No.". Only the stable "Ref ID" survives the rename.
        OldAmount := Doc.Amount;
        NewNo := CopyStr('DOC-' + Format(OldAmount * 3 + 11), 1, 20);
        Doc.Rename(NewNo);

        // Amount is likewise rewritten to an opaque function of its prior
        // value, applied to the SAME (now-renamed) row via this local
        // variable, which still tracks the row correctly within this one
        // call frame.
        Doc.Amount := OldAmount * 7 + 2;
        Doc.Modify(true);
    end;
}
