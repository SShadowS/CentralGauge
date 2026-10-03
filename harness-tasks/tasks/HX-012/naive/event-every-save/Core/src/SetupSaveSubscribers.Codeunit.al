codeunit 70011 "CGR Setup Save Subscribers"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Setup", 'OnAfterInsertEvent', '', false, false)]
    local procedure RefreshAfterSetupInsert(var Rec: Record "CGR Setup"; RunTrigger: Boolean)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Setup", 'OnAfterModifyEvent', '', false, false)]
    local procedure RefreshAfterSetupModify(var Rec: Record "CGR Setup"; var xRec: Record "CGR Setup"; RunTrigger: Boolean)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Setup", 'OnAfterDeleteEvent', '', false, false)]
    local procedure RefreshAfterSetupDelete(var Rec: Record "CGR Setup"; RunTrigger: Boolean)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;
}
