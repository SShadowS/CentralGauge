codeunit 69062 "CG DT Prereq Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Src: Record "CG DT Source";
        Dst: Record "CG DT Destination";
    begin
        if Src.IsEmpty() then begin
            Src.Init();
            Src."No." := 'A';
            Src."Legacy Value" := 'val-a';
            Src.Insert();

            Src.Init();
            Src."No." := 'B';
            Src."Legacy Value" := 'val-b';
            Src.Insert();

            Src.Init();
            Src."No." := 'C';
            Src."Legacy Value" := 'val-c';
            Src.Insert();
        end;

        if Dst.IsEmpty() then begin
            Dst.Init();
            Dst."No." := 'A';
            Dst."New Value" := '';
            Dst.Insert();

            Dst.Init();
            Dst."No." := 'B';
            Dst."New Value" := 'preset-b';
            Dst.Insert();

            Dst.Init();
            Dst."No." := 'C';
            Dst."New Value" := '';
            Dst.Insert();
        end;
    end;
}
