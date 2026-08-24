codeunit 70621 "CG X102 Buffer Service"
{
    procedure TakeSnapshot(var Source: Record "CG X102 Working Row" temporary; var Snapshot: Record "CG X102 Working Row" temporary)
    begin
        Snapshot.Copy(Source, true);
    end;

    procedure AttachSharedView(var Source: Record "CG X102 Working Row" temporary; var SharedView: Record "CG X102 Working Row" temporary)
    begin
        SharedView.Copy(Source, true);
    end;
}
