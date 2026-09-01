codeunit 70661 "CG X106 Archive Mgt"
{
    procedure ArchiveDocument(No: Code[20])
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Get(No);
        OnBeforeArchiveEnrich(Doc);
        OnBeforeArchiveFinalize(Doc);
        Doc.Modify(true);
    end;

    procedure RefreshArchiveTag(No: Code[20])
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Get(No);
        OnBeforeArchiveFinalize(Doc);
        Doc.Modify(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeArchiveEnrich(var Doc: Record "CG X106 Document")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeArchiveFinalize(var Doc: Record "CG X106 Document")
    begin
    end;
}
