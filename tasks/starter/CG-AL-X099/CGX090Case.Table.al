table 70550 "CG X090 Case"
{
    DataClassification = CustomerContent;
    Caption = 'CG X090 Case';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Assigned Team"; Code[20])
        {
            Caption = 'Assigned Team';
            DataClassification = CustomerContent;
        }
        field(3; Description; Text[100])
        {
            Caption = 'Description';
            DataClassification = CustomerContent;
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
