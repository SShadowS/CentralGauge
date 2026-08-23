codeunit 70462 "CG X081 Line Defaults Mgt"
{
    Access = Public;

    procedure AssignItemValues(var OrderLine: Record "CG X081 Order Line")
    var
        Item: Record "CG X081 Item";
    begin
        if OrderLine."Item No." <> '' then
            Item.Get(OrderLine."Item No.")
        else
            Clear(Item);

        OnAfterAssignItemValues(OrderLine, Item);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterAssignItemValues(var OrderLine: Record "CG X081 Order Line"; Item: Record "CG X081 Item")
    begin
    end;
}
