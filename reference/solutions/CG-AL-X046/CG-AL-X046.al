codeunit 71350 "CG X046 Archiver"
{
    Access = Internal;

    procedure Archive(No: Code[20])
    var
        CGX046Doc: Record "CG X046 Doc";
        CGX046Archive: Record "CG X046 Archive";
        CGX046Vault: Codeunit "CG X046 Vault";
    begin
        CGX046Vault.Stash(No);

        CGX046Doc.Get(No);

        CGX046Archive.Init();
        CGX046Archive."No." := CGX046Doc."No.";
        CGX046Archive.Amount := CGX046Doc.Amount;
        CGX046Archive.Note := CGX046Doc.Note;
        CGX046Archive.SystemId := CGX046Doc.SystemId;
        CGX046Archive.Insert(false, true);
    end;
}