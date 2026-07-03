codeunit 69972 "CG X046 Vault"
{
    // Innocuous-verb hidden mutation: Stash reads as "just persist a copy",
    // but it opaquely rewrites the document's payload fields in place before
    // any archive of that document can be considered current. Any Doc buffer
    // captured before this call is stale the instant it returns.
    procedure Stash(No: Code[20])
    var
        Doc: Record "CG X046 Doc";
    begin
        Doc.Get(No);
        Doc.Amount := Doc.Amount + StashDelta(No);
        Doc.Note := CopyStr(StashTag(No) + Doc.Note, 1, MaxStrLen(Doc.Note));
        Doc.Modify();
    end;

    local procedure StashDelta(No: Code[20]): Integer
    begin
        case No of
            'D1':
                exit(347);
            'D2':
                exit(812);
            else
                exit(101);
        end;
    end;

    local procedure StashTag(No: Code[20]): Text[30]
    begin
        exit('VAULT-' + No + '-');
    end;
}
