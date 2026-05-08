table 69060 "CG DT Source"
{
    Caption = 'CG DT Source';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            NotBlank = true;
        }
        field(10; "Legacy Value"; Text[50])
        {
            Caption = 'Legacy Value';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
