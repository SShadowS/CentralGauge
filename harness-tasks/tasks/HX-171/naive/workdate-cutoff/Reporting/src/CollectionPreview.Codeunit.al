codeunit 70592 "CGR Collection Preview"
{
    procedure BuildCollectionPreview(var Contract: Record "CGR Lease Contract"; UpToDate: Date; var Preview: Record "CGR Collection Preview Line" temporary)
    begin
        Preview.Reset();
        Preview.DeleteAll();
        if Contract.FindSet() then
            repeat
                Preview.Init();
                Preview."Contract No." := Contract."No.";
                Preview."Line No." := 0;
                Preview."Due Date" := UpToDate;
                if not Codeunit.Run(Codeunit::"CGR Collection Line Check", Preview) then
                    AddErrorLine(Preview, Contract."No.", GetLastErrorText());
            until Contract.Next() = 0;
    end;

    local procedure AddErrorLine(var Preview: Record "CGR Collection Preview Line" temporary; ContractNo: Code[20]; ErrorText: Text)
    begin
        // The lines the failed check inserted into the temporary preview are not rolled back.
        Preview.Reset();
        Preview.SetRange("Contract No.", ContractNo);
        Preview.DeleteAll();
        Preview.Reset();

        Preview.Init();
        Preview."Contract No." := ContractNo;
        Preview."Line No." := 0;
        Preview."Due Date" := 0D;
        Preview.Amount := 0;
        Preview."Error Text" := CopyStr(ErrorText, 1, MaxStrLen(Preview."Error Text"));
        Preview.Insert();
    end;
}
