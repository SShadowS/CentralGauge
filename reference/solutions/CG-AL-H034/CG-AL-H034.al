codeunit 70340 "CG H034 Engine"
{
    Access = Public;

    procedure ProcessItem(var Item: Record "CG H034 Item")
    begin
        Item.Status := true;
        Item.Modify();

        OnBeforeFinalize(Item);

        if Item.Marker = 'FAIL' then
            Error('Process failed for %1', Item.Code);

        Commit();
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    [IntegrationEvent(true, false)]
    local procedure OnBeforeFinalize(var Item: Record "CG H034 Item")
    begin
    end;
}