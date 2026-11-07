codeunit 70403 "CGR Contract Change Subs"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Rental Contract", 'OnAfterModifyEvent', '', false, false)]
    local procedure QueueContractChanged(var Rec: Record "CGR Rental Contract"; var xRec: Record "CGR Rental Contract"; RunTrigger: Boolean)
    var
        Facade: Codeunit "CGR Integration Facade";
        Silencer: Codeunit "CGR Integration Silencer";
    begin
        if Rec.IsTemporary() then
            exit;
        if Silencer.IsSilenced() then
            exit;
        Facade.QueueMessage('contractChanged', Rec."Vehicle No.", Rec."No.");
    end;
}
