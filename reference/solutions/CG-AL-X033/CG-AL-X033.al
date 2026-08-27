codeunit 71220 "CG X033 Archiver"
{
    Access = Internal;

    procedure ArchiveDoc(var Doc: Record "CG X033 Doc"; var Archive: Record "CG X033 Archive")
    begin
        Archive.Init();
        Archive."No." := Doc."No.";
        Archive."Net Amount" := Doc."Net Amount";
        Archive."Freight Amount" := Doc."Freight Amount";
        Archive."Note" := Doc."Note";
        Archive.Insert();
    end;
}