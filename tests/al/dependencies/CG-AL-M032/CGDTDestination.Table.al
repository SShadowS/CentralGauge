table 69061 "CG DT Destination"
{
    Caption = 'CG DT Destination';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            NotBlank = true;
        }
        field(10; "New Value"; Text[50])
        {
            Caption = 'New Value';
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
