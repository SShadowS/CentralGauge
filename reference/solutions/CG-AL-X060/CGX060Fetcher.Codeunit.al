codeunit 71470 "CG X060 Fetcher"
{
    Access = Internal;

    procedure Fetch(ItemNo: Code[20]; var Item: Record "CG X060 Item")
    begin
        Clear(Item);
        Item.SetLoadFields(Item.Description);
        Item.Get(ItemNo);
    end;
}
