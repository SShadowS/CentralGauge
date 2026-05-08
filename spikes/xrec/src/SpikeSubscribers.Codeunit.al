codeunit 90001 "CG Spike Subscribers"
{
    [EventSubscriber(ObjectType::Table, Database::Customer, OnAfterModifyEvent, '', false, false)]
    local procedure OnAfterModifyCustomer(var Rec: Record Customer; var xRec: Record Customer; RunTrigger: Boolean)
    var
        Logger: Codeunit "CG Spike Logger";
    begin
        Logger.Log(StrSubstNo('U1-AfterModify: Rec.Ext=%1; xRec.Ext=%2', Rec."CG Spike Ext", xRec."CG Spike Ext"));
    end;

    [EventSubscriber(ObjectType::Table, Database::Customer, OnAfterValidateEvent, 'Name', false, false)]
    local procedure OnAfterValidateCustomerName(var Rec: Record Customer; var xRec: Record Customer; CurrFieldNo: Integer)
    var
        Logger: Codeunit "CG Spike Logger";
    begin
        Logger.Log(StrSubstNo('U4-AfterValidate-Name: Rec.Name=%1; xRec.Name=%2', Rec.Name, xRec.Name));
    end;
}
