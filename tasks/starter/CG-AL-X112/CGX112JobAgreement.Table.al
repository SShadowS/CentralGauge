table 70720 "CG X112 Job Agreement"
{
    DataClassification = CustomerContent;
    Caption = 'CG X112 Job Agreement';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Description"; Text[100])
        {
            Caption = 'Description';
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
