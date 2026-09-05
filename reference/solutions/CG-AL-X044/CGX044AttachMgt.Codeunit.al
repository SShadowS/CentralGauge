codeunit 71330 "CG X044 Attach Mgt"
{
    Access = Internal;

    procedure AttachFile(Widget: Record "CG X044 Widget"; FileName: Text; var TempBlob: Codeunit "Temp Blob")
    var
        DocAttach: Record "Document Attachment";
        RecRef: RecordRef;
    begin
        RecRef.GetTable(Widget);
        DocAttach.SaveAttachment(RecRef, FileName, TempBlob);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Document Attachment Mgmt", 'OnAfterTableHasNumberFieldPrimaryKey', '', false, false)]
    local procedure OnAfterTableHasNumberFieldPrimaryKey(TableNo: Integer; var Result: Boolean; var FieldNo: Integer)
    begin
        if TableNo = Database::"CG X044 Widget" then begin
            Result := true;
            FieldNo := 1;
        end;
    end;
}
